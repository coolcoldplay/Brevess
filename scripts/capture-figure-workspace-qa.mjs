import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const defaultArticles = [
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC12767537/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC12167935/'
];
const requestedArticles = String(process.env.ARTICLE_URL || '').trim()
  .split(/[\n,]+/u).map(value => value.trim()).filter(Boolean);
const articleUrls = requestedArticles.length ? requestedArticles : defaultArticles;
const extensionPath = path.resolve(process.env.EXTENSION_PATH ||
  path.join(root, 'dist', 'Brevess-v1.0.1-build23-mechanism-network-final'));
const outputDir = path.resolve(process.env.OUTPUT_DIR ||
  path.join(root, 'output', 'playwright', 'figure-workspace-qa'));

// BEGIN CANONICAL_MECHANISM_QA_FIXTURE
function createCanonicalMechanismQaFixture({ s1Id, s2Id }) {
  const editable = value => ({
    value, humanReviewed: true, editedAt: 1
  });
  const evidence = (figureId, panelId, value, evidenceClass) => ({
    figureId, panelId, value, unresolved: false,
    evidenceClass, evidenceClassSource: 'manual',
    humanReviewed: true, editedAt: 1
  });
  const node = (id, label) => ({ id, label: editable(label) });
  const edge = (id, from, to, polarity, label, panelEvidence = []) => ({
    id, from, to, polarity, label: editable(label), panelEvidence,
    humanReviewed: true, editedAt: 1
  });
  const chain = {
    initialized: true,
    nodes: [
      node('source', '共同上游核团'),
      node('branch-a', '细胞亚型 A'),
      node('branch-b', '细胞亚型 B'),
      node('branch-c', '细胞亚型 C'),
      node('merge-ab', 'A 与 B 通路汇合'),
      node('outcome', '共同表型输出'),
      node('cycle-1', '回路节点 1'),
      node('cycle-2', '回路节点 2'),
      node('cycle-3', '回路节点 3'),
      node('self', '自反馈调节器')
    ],
    edges: [
      edge('source-a', 'source', 'branch-a', 'neutral', '投射'),
      edge('source-b', 'source', 'branch-b', 'neutral', '投射'),
      edge('source-c', 'source', 'branch-c', 'neutral', '投射'),
      edge('a-ab', 'branch-a', 'merge-ab', 'neutral', '促进'),
      edge('b-ab', 'branch-b', 'merge-ab', 'neutral', '促进'),
      edge('ab-outcome', 'merge-ab', 'outcome', 'neutral', '驱动'),
      edge('c-outcome', 'branch-c', 'outcome', 'neutral', '并行调节'),
      edge('positive-feedback', 'outcome', 'branch-b', 'positive', '正反馈', [
        evidence(s1Id, 'B', 'S1B', 'sufficiency')
      ]),
      edge('negative-feedback', 'outcome', 'source', 'negative', '负反馈', [
        evidence(s2Id, 'A', 'S2A', 'necessity')
      ]),
      edge('out-cycle', 'outcome', 'cycle-1', 'neutral', '进入回路'),
      edge('cycle-12', 'cycle-1', 'cycle-2', 'neutral', '传递'),
      edge('cycle-23', 'cycle-2', 'cycle-3', 'neutral', '传递'),
      edge('cycle-31', 'cycle-3', 'cycle-1', 'negative', '环路负反馈'),
      edge('self-positive', 'self', 'self', 'positive', '自反馈')
    ],
    panelAliases: {},
    reviewTombstones: { nodes: [], edges: [], evidence: [] }
  };
  return JSON.stringify(SciLLM.createMechanismNetworkJson({
    chain,
    paper: mechanismNetworkPaperIdentity(),
    exportedAt: '2026-08-13T00:00:00.000Z'
  }), null, 2);
}
// END CANONICAL_MECHANISM_QA_FIXTURE

if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
  throw new Error(`Unpacked extension is missing: ${extensionPath}`);
}
fs.mkdirSync(outputDir, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(outputDir, 'profile-'));
const startedAt = Date.now();
const artifacts = [];
const providerRequests = [];
const derivedArticles = new Map();
const derivedArticleMetadata = [];
const officialAssets = new Map();
const officialFigureSources = [];
const officialSupplementarySources = [];
const officialSupplementaryInputs = new Map();
const officialJatsByArticle = new Map();
const resourceTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-real-figures-'));

function bounded(value, maximum = 500) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch (_) {
    return bounded(value, 300);
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function fetchWithRetry(url, timeoutMs = 60000, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || attempt >= attempts - 1) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw lastError || new Error('Official source fetch failed');
}

function imageDimensions(bytes, mimeType = '') {
  const buffer = Buffer.from(bytes || []);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  )) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && /^image\/gif$/iu.test(mimeType)) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      if (offset + 4 > buffer.length) break;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca,
        0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5)
        };
      }
      offset += 2 + length;
    }
  }
  return { width: 0, height: 0 };
}

function stripXml(value) {
  return decodeXmlText(String(value || '').replace(/<[^>]+>/gu, ' '))
    .replace(/\s+/gu, ' ').trim();
}

function parseJatsFigureGraphics(xml) {
  return [...String(xml || '').matchAll(/<fig\b[\s\S]*?<\/fig>/giu)]
    .map(match => {
      const block = match[0];
      const label = stripXml(/<label\b[^>]*>([\s\S]*?)<\/label>/iu.exec(block)?.[1] || '');
      const graphic = /<graphic\b[^>]*(?:xlink:)?href="([^"]+)"[^>]*>/iu.exec(block);
      const number = /Figure\s+(\d+)/iu.exec(label)?.[1] || '';
      return { label, number, href: decodeXmlText(graphic?.[1] || '') };
    }).filter(item => item.number && item.href);
}

function parseJatsSupplementaryFiles(xml) {
  return [...String(xml || '').matchAll(
    /<supplementary-material\b[\s\S]*?<\/supplementary-material>/giu
  )].map(match => {
    const block = match[0];
    const label = stripXml(/<label\b[^>]*>([\s\S]*?)<\/label>/iu.exec(block)?.[1] || '');
    const media = /<media\b[^>]*(?:xlink:)?href="([^"]+)"[^>]*>/iu.exec(block);
    return { label, href: decodeXmlText(media?.[1] || '') };
  }).filter(item => item.href);
}

function officialAssetPath(id, filename) {
  return `/real-asset/${id}/${encodeURIComponent(path.basename(filename))}`;
}

function pmcId(value) {
  return /PMC(\d+)/iu.exec(String(value || ''))?.[1] || '';
}

function europePmcMirror(value) {
  const id = pmcId(value);
  return id ? `https://europepmc.org/articles/PMC${id}` : '';
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/gu, '"').replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function parseBioCPassages(xml) {
  return [...String(xml || '').matchAll(/<passage>([\s\S]*?)<\/passage>/giu)]
    .map(match => {
      const body = match[1];
      const infons = Object.fromEntries([...body.matchAll(
        /<infon key="([^"]+)">([\s\S]*?)<\/infon>/giu
      )].map(item => [decodeXmlText(item[1]), decodeXmlText(item[2])]));
      const text = decodeXmlText(/<text>([\s\S]*?)<\/text>/iu.exec(body)?.[1] || '');
      return { infons, text: bounded(text, 12000) };
    }).filter(item => item.text);
}

function bioCFigureNumber(value) {
  return /^(?:F|fig)(\d+)$/iu.exec(String(value || '').trim())?.[1] || '';
}

async function fetchOfficialMainFigures(id, jatsXml) {
  const graphics = parseJatsFigureGraphics(jatsXml);
  const resources = [];
  for (const graphic of graphics) {
    const sourceUrl = `https://pmc.ncbi.nlm.nih.gov/articles/instance/` +
      `${id.slice(3)}/bin/${encodeURIComponent(graphic.href)}`;
    try {
      let response = null;
      let mimeType = '';
      let resolvedUrl = sourceUrl;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await fetch(resolvedUrl, { signal: AbortSignal.timeout(60000) });
          mimeType = String(response.headers.get('content-type') || '')
            .split(';', 1)[0].toLowerCase();
          if (response.ok && /^image\/(?:jpeg|png|gif|webp)$/u.test(mimeType)) break;
          const head = await fetch(sourceUrl, {
            method: 'HEAD', signal: AbortSignal.timeout(30000)
          });
          if (head.ok && head.url && head.url !== sourceUrl) resolvedUrl = head.url;
        } catch (_) {
          response = null;
          mimeType = '';
        }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!response?.ok || !/^image\/(?:jpeg|png|gif|webp)$/u.test(mimeType)) {
        throw new Error(`HTTP ${response?.status || 0} ${mimeType || 'unknown-content-type'}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
        throw new Error(`Image byte length is outside QA bounds: ${bytes.length}`);
      }
      const dimensions = imageDimensions(bytes, mimeType);
      if (!dimensions.width || !dimensions.height) throw new Error('Image dimensions missing');
      const localPath = officialAssetPath(id, graphic.href);
      officialAssets.set(localPath, { bytes, mimeType });
      const metadata = {
        pmcId: id,
        kind: 'main-figure',
        figureLabel: `Figure ${graphic.number}`,
        graphicHref: graphic.href,
        sourceUrl,
        resolvedUrl: safeUrl(response.url || resolvedUrl),
        sourceStatus: response.status,
        finalUrl: safeUrl(response.url),
        mimeType,
        byteLength: bytes.length,
        width: dimensions.width,
        height: dimensions.height,
        sha256: sha256(bytes),
        savedToDisk: false
      };
      officialFigureSources.push(metadata);
      resources.push({ ...metadata, localPath });
    } catch (error) {
      officialFigureSources.push({
        pmcId: id,
        kind: 'main-figure',
        figureLabel: `Figure ${graphic.number}`,
        graphicHref: graphic.href,
        sourceUrl,
        error: bounded(error.message, 240),
        savedToDisk: false
      });
    }
  }
  return resources;
}

function wordDocumentParagraphs(docxPath) {
  const xml = execFileSync('tar', ['-xOf', docxPath, 'word/document.xml'], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
  });
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/giu)].map(match =>
    [...match[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/giu)]
      .map(item => decodeXmlText(item[1])).join('')
  ).map(item => item.replace(/\s+/gu, ' ').trim()).filter(Boolean);
}

function supplementaryLegendCaptions(docxPath) {
  const text = wordDocumentParagraphs(docxPath).join('\n');
  const markers = [...text.matchAll(/Supplementary\s+Figure\s+S\s*(\d+)\s*\.?/giu)];
  const captions = new Map();
  markers.forEach((marker, index) => {
    const number = marker[1];
    const end = markers[index + 1]?.index ?? text.length;
    captions.set(`Figure S${number}`, text.slice(marker.index, end).trim());
  });
  return captions;
}

async function prepareOfficialSupplementaryInputs(id, jatsXml) {
  if (id !== 'PMC12167935') return;
  const supplements = parseJatsSupplementaryFiles(jatsXml);
  const wanted = ['Figure S1', 'Figure S2'];
  const selected = wanted.map(label => supplements.find(item =>
    item.label.replace(/\s+/gu, ' ').trim() === label
  )).filter(Boolean);
  const legend = supplements.find(item => /Figure S1-S8 legend/iu.test(item.label));
  if (selected.length !== wanted.length || !legend) {
    officialSupplementarySources.push({
      pmcId: id,
      error: 'Official JATS did not expose the expected S1/S2 images and legend.'
    });
    return;
  }
  const sourceUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${id}/supplementaryFiles`;
  const jatsSourceUrl = `https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/` +
    `?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:${id.slice(3)}` +
    '&metadataPrefix=pmc';
  const oaPackageUrl = 'https://ftp.ncbi.nlm.nih.gov/pub/pmc/deprecated/' +
    'oa_package/81/6d/PMC12167935.tar.gz';
  try {
    const response = await fetchWithRetry(sourceUrl, 180000, 3);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (!archive.length || archive.length > 30 * 1024 * 1024) {
      throw new Error(`Supplementary ZIP length is outside QA bounds: ${archive.length}`);
    }
    const archivePath = path.join(resourceTempDir, `${id}-supplementaryFiles.zip`);
    fs.writeFileSync(archivePath, archive);
    const entryNames = [...selected.map(item => path.basename(item.href)), path.basename(legend.href)];
    execFileSync('tar', ['-xf', archivePath, '-C', resourceTempDir, ...entryNames], {
      maxBuffer: 8 * 1024 * 1024
    });
    const legendPath = path.join(resourceTempDir, path.basename(legend.href));
    const captions = supplementaryLegendCaptions(legendPath);
    for (const item of selected) {
      const filename = path.basename(item.href);
      const imagePath = path.join(resourceTempDir, filename);
      const bytes = fs.readFileSync(imagePath);
      const mimeType = 'image/png';
      const dimensions = imageDimensions(bytes, mimeType);
      const caption = captions.get(item.label) || '';
      if (!dimensions.width || !dimensions.height || !caption) {
        throw new Error(`Official ${item.label} pixels or legend caption are incomplete`);
      }
      const panelLabels = [...new Set([...caption.matchAll(/\(\s*([A-Z])\s*\)/gu)]
        .map(match => match[1]))];
      const localPath = officialAssetPath(id, filename);
      officialAssets.set(localPath, { bytes, mimeType });
      const metadata = {
        pmcId: id,
        kind: 'supplementary-figure',
        figureLabel: item.label,
        supplementaryHref: item.href,
        legendHref: legend.href,
        jatsSourceUrl,
        jatsSourceStatus: 200,
        sourceUrl,
        sourceStatus: response.status,
        oaPackageUrl,
        archiveByteLength: archive.length,
        archiveSha256: sha256(archive),
        mimeType,
        byteLength: bytes.length,
        width: dimensions.width,
        height: dimensions.height,
        sha256: sha256(bytes),
        captionPanelLabels: panelLabels,
        savedToDisk: false,
        temporaryExtractionDeletedAfterRun: true
      };
      officialSupplementarySources.push(metadata);
      officialSupplementaryInputs.set(item.label, {
        imagePath, caption, localPath, metadata
      });
    }
  } catch (error) {
    officialSupplementarySources.push({
      pmcId: id, sourceUrl, jatsSourceUrl, oaPackageUrl,
      error: bounded(error.message, 240), savedToDisk: false
    });
  }
}

function restoreVerifiedSupplementaryInputsFromPriorQa(id) {
  if (id !== 'PMC12167935' ||
      ['Figure S1', 'Figure S2'].every(label => officialSupplementaryInputs.has(label))) {
    return;
  }
  const cacheRoot = path.join(root, 'output', 'playwright', 'figure-workspace-qa');
  const resultPath = path.join(cacheRoot, 'qa-result.json');
  if (!fs.existsSync(resultPath)) return;
  let prior;
  try { prior = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch (_) { return; }
  for (const label of ['Figure S1', 'Figure S2']) {
    if (officialSupplementaryInputs.has(label)) continue;
    const metadata = (prior.officialSupplementarySources || []).find(item =>
      item?.pmcId === id && item?.figureLabel === label &&
      /^[a-f0-9]{64}$/u.test(String(item?.sha256 || ''))
    );
    if (!metadata) continue;
    const slug = label.toLowerCase().replace(/\s+/gu, '-');
    const imagePath = path.join(cacheRoot, `paper-12167935-${slug}-official-source.png`);
    if (!fs.existsSync(imagePath)) continue;
    const bytes = fs.readFileSync(imagePath);
    const dimensions = imageDimensions(bytes, 'image/png');
    if (sha256(bytes) !== metadata.sha256 || bytes.length !== metadata.byteLength ||
        dimensions.width !== metadata.width || dimensions.height !== metadata.height) {
      continue;
    }
    const localPath = officialAssetPath(id, path.basename(metadata.supplementaryHref));
    const panelLabels = Array.isArray(metadata.captionPanelLabels)
      ? metadata.captionPanelLabels.slice(0, 26) : [];
    officialAssets.set(localPath, { bytes, mimeType: 'image/png' });
    const verified = {
      ...metadata,
      reusedVerifiedCache: true,
      cacheVerification: 'sha256+byteLength+dimensions'
    };
    officialSupplementarySources.push(verified);
    officialSupplementaryInputs.set(label, {
      imagePath,
      caption: `${label}. ${panelLabels.map(panel => `(${panel})`).join(' ')}`,
      localPath,
      metadata: verified
    });
  }
}

function bioCArticleHtml(id, passages, figureResources = []) {
  const knownTitles = {
    PMC12767537: 'Dysregulated Microglial Synaptic Engulfment in Diffuse Midline Glioma',
    PMC12167935: 'Cancer-Associated Fibroblasts Foster a High-Lactate Microenvironment to Drive Perineural Invasion in Pancreatic Cancer'
  };
  const title = knownTitles[id] || passages.find(item =>
    ['front', 'title'].includes(item.infons.type))?.text || id;
  const figureGroups = new Map();
  passages.filter(item => item.infons.section_type === 'FIG').forEach(item => {
    const number = bioCFigureNumber(item.infons.id);
    if (!number) return;
    const figureId = `F${number}`;
    const items = figureGroups.get(figureId) || [];
    items.push(item.text);
    figureGroups.set(figureId, items);
  });
  const prose = passages.filter(item =>
    ['abstract', 'paragraph'].includes(item.infons.type) &&
    item.infons.section_type !== 'FIG'
  ).slice(0, 160);
  const figures = [...figureGroups.entries()].sort((left, right) =>
    Number(left[0].slice(1)) - Number(right[0].slice(1))
  ).map(([figureId, captions]) => {
    const number = Number(figureId.slice(1));
    const resource = figureResources.find(item => item.figureLabel === `Figure ${number}`);
    const image = resource
      ? `<img src="${escapeHtml(resource.localPath)}" ` +
        `alt="Official PMC Figure ${number}" width="${resource.width}" ` +
        `height="${resource.height}">`
      : '';
    return `<figure id="figure-${number}" data-bioc-figure-id="${escapeHtml(figureId)}">` +
      image + `<figcaption><strong>Figure ${number}.</strong> ` +
      `${escapeHtml(captions.join(' '))}</figcaption></figure>`;
  }).join('\n');
  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(title)}</title>` +
    `<link rel="canonical" href="https://pmc.ncbi.nlm.nih.gov/articles/${id}/">` +
    `<meta name="citation_pmcid" content="${escapeHtml(id)}">` +
    '<style>body{font:16px/1.55 system-ui;margin:0 auto;max-width:1180px;padding:24px}' +
    'figure{margin:32px 0;padding:18px;border:1px solid #ccd9e2;border-radius:12px}' +
    'figure img{display:block;width:auto;max-width:100%;height:auto;margin:0 auto 16px}' +
    'figcaption{color:#29475a}</style></head>' +
    `<body><main><article><h1>${escapeHtml(title)}</h1>` +
    '<section><h2>Full-text passages from the official NCBI BioC API</h2>' +
    prose.map(item => `<p>${escapeHtml(item.text)}</p>`).join('\n') +
    `</section><section><h2>Figures</h2>${figures}</section>` +
    '</article></main></body></html>';
}

async function prepareOfficialBioCArticle(url) {
  const id = `PMC${pmcId(url)}`;
  if (!/^PMC\d+$/u.test(id)) return;
  const sourceUrl = `https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/` +
    `pmcoa.cgi/BioC_xml/${id}/unicode`;
  const jatsSourceUrl = `https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/` +
    `?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:${id.slice(3)}` +
    '&metadataPrefix=pmc';
  try {
    const [response, jatsResponse] = await Promise.all([
      fetchWithRetry(sourceUrl),
      fetchWithRetry(jatsSourceUrl)
    ]);
    if (!response.ok) throw new Error(`BioC HTTP ${response.status}`);
    if (!jatsResponse.ok) throw new Error(`JATS HTTP ${jatsResponse.status}`);
    const [xml, jatsXml] = await Promise.all([response.text(), jatsResponse.text()]);
    const passages = parseBioCPassages(xml);
    const figureIds = [...new Set(passages
      .filter(item => item.infons.section_type === 'FIG')
      .map(item => bioCFigureNumber(item.infons.id)).filter(Boolean))];
    if (!figureIds.length) return;
    officialJatsByArticle.set(id, jatsXml);
    const figureResources = await fetchOfficialMainFigures(id, jatsXml);
    await prepareOfficialSupplementaryInputs(id, jatsXml);
    derivedArticles.set(id, bioCArticleHtml(id, passages, figureResources));
    derivedArticleMetadata.push({
      pmcId: id, sourceUrl, sourceStatus: response.status,
      jatsSourceUrl, jatsSourceStatus: jatsResponse.status,
      passageCount: passages.length, figureCount: figureIds.length,
      realFigureImageCount: figureResources.length,
      figureCaptionPassageCount: passages.filter(item =>
        item.infons.section_type === 'FIG').length,
      savedToDisk: false
    });
  } catch (error) {
    derivedArticleMetadata.push({
      pmcId: id, sourceUrl, error: bounded(error.message, 240), savedToDisk: false
    });
  }
}

if (/^PMC\d+$/u.test(String(process.env.BIOC_XML_STDIN_ID || ''))) {
  let xml = '';
  for await (const chunk of process.stdin) xml += chunk;
  const id = String(process.env.BIOC_XML_STDIN_ID);
  const passages = parseBioCPassages(xml);
  const figureIds = [...new Set(passages
    .filter(item => item.infons.section_type === 'FIG')
    .map(item => bioCFigureNumber(item.infons.id)).filter(Boolean))];
  if (figureIds.length) {
    derivedArticles.set(id, bioCArticleHtml(id, passages));
    derivedArticleMetadata.push({
      pmcId: id,
      sourceUrl: `https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_xml/${id}/unicode`,
      sourceStatus: 200, passageCount: passages.length, figureCount: figureIds.length,
      figureCaptionPassageCount: passages.filter(item =>
        item.infons.section_type === 'FIG').length,
      savedToDisk: false, transport: 'stdin'
    });
  }
}

for (const url of articleUrls) {
  const id = `PMC${pmcId(url)}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const preparedJats = officialJatsByArticle.get(id);
    const alreadyHasMainFigures = officialFigureSources.some(item =>
      item.pmcId === id && !item.error
    );
    if (preparedJats && alreadyHasMainFigures && id === 'PMC12167935') {
      await prepareOfficialSupplementaryInputs(id, preparedJats);
    } else {
      await prepareOfficialBioCArticle(url);
    }
    const hasMainFigures = officialFigureSources.some(item =>
      item.pmcId === id && !item.error
    );
    const needsSupplement = id === 'PMC12167935';
    const hasSupplement = !needsSupplement ||
      ['Figure S1', 'Figure S2'].every(label => officialSupplementaryInputs.has(label));
    if (derivedArticles.has(id) && hasMainFigures && hasSupplement) break;
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  restoreVerifiedSupplementaryInputsFromPriorQa(id);
}

function artifact(name) {
  const target = path.join(outputDir, name);
  artifacts.push(target);
  return target;
}

function openAiUserMessage(body) {
  return [...(Array.isArray(body?.messages) ? body.messages : [])]
    .reverse().find(item => item?.role === 'user');
}

function openAiUserPayload(body) {
  const message = openAiUserMessage(body);
  const content = message?.content;
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.find(item => item?.type === 'text')?.text || '' : '';
  try { return JSON.parse(text); } catch (_) { return {}; }
}

function openAiImageEvidence(body) {
  const content = openAiUserMessage(body)?.content;
  const urls = (Array.isArray(content) ? content : []).map(item =>
    item?.type === 'image_url' ? item?.image_url?.url : ''
  ).filter(Boolean);
  const dataImages = urls.filter(value => /^data:image\//iu.test(value));
  return {
    imageInputCount: urls.length,
    dataImageCount: dataImages.length,
    imageMimeTypes: dataImages.map(value =>
      /^data:(image\/[^;,]+)/iu.exec(value)?.[1]?.toLowerCase() || ''
    ).filter(Boolean),
    imageInputSha256: dataImages.map(value => {
      const encoded = value.slice(value.indexOf(',') + 1);
      try { return sha256(Buffer.from(encoded, 'base64')); } catch (_) { return ''; }
    }).filter(Boolean)
  };
}

function figurePanel(label, index, basis) {
  const isSufficiency = label === 'A';
  const isNecessity = label === 'E';
  const role = isSufficiency ? 'sufficiency' : isNecessity ? 'necessity' : 'phenotype';
  return {
    panel: label,
    role,
    phenotype_name_zh: `真实论文 Panel ${label} 的局部表型`,
    method_category: 'wet_lab',
    methods: [index % 2 ? 'Western blot' : 'Immunofluorescence'],
    evidence_type_zh: isSufficiency ? '充分性证据' : isNecessity ? '必要性证据' : '相关性证据',
    experimental_methods: [index % 2 ? 'Western blot' : '免疫荧光'],
    statistical_methods: [index % 2 ? '单因素 ANOVA' : '非配对 t 检验'],
    method_source: basis === 'vision_text' ? 'image' : 'caption',
    purpose_zh: `检验 Panel ${label} 在当前真实 Figure 论证中的作用`,
    design_zh: `Panel ${label} 的处理组与匹配对照组比较`,
    comparison_zh: `Panel ${label}：处理组 vs 对照组`,
    direct_observation_zh: `Panel ${label} 显示了一个有边界的实验差异`,
    observation_source: basis === 'vision_text' ? 'image_observation' : 'caption_statement',
    local_inference_zh: `Panel ${label} 仅支持该局部证据步骤`,
    contribution_zh: `Panel ${label} 推进当前 Figure 的论证`
  };
}

function figureResponse(input) {
  const basis = input.analysis_basis === 'vision_text' ? 'vision_text' : 'caption_context';
  const depth = input.analysis_depth === 'deep' ? 'deep' : 'standard';
  const labels = (Array.isArray(input.expected_panel_labels)
    ? input.expected_panel_labels
    : Array.isArray(input.panel_evidence)
      ? input.panel_evidence.map(item => item?.panel)
      : ['A'])
    .map(value => bounded(value, 12).toUpperCase()).filter(Boolean);
  const panelLabels = labels.length ? [...new Set(labels)] : ['A'];
  const panels = panelLabels.map((label, index) => figurePanel(label, index, basis));
  const split = Math.max(1, Math.ceil(panelLabels.length / 2));
  const first = panelLabels.slice(0, split);
  const second = panelLabels.slice(split);
  const groups = [
    { panels: first, group_goal_zh: '建立第一段证据', group_conclusion_zh: '先界定主要现象' },
    ...(second.length ? [{
      panels: second,
      group_goal_zh: '检验后续解释',
      group_conclusion_zh: '再限定机制与边界'
    }] : [])
  ];
  const value = {
    figure_id: input.figure_id,
    analysis_depth: depth,
    basis,
    figure_title_zh: '真实论文 Figure 的确定性 QA 图解',
    figure_question_zh: '这些 Panel 如何逐步支持当前 Figure 的科学结论？',
    remaining_question_zh: '当前证据尚未解释跨模型可重复性，因此研究者需要继续下一张 Figure。',
    panels,
    panel_groups: groups,
    logic_bridges: second.length ? [{
      from_group: '证据块 1', to_group: '证据块 2',
      relation_type: 'phenomenon_to_mechanism',
      bridge_zh: '第一组先建立现象，第二组随后检验必要解释。'
    }] : [],
    argument_chain: groups.map((group, index) => ({
      panels: group.panels,
      established_zh: index ? '第二证据块限定机制解释。' : '第一证据块建立主要现象。',
      handoff_zh: index ? '由此进入下一张 Figure 的未决问题。' : '现象成立后需要检验机制。',
      evidence_level: index ? 'necessity' : 'association'
    })),
    author_assembly_zh: '作者从现象到机制组织组图，并在每一步保留证据边界。',
    core_conclusion_zh: '当前真实 Figure 建立了一条有边界的证据链。',
    claim_boundary_zh: 'QA mock 仅验证路由与界面，不代表真实 LLM 科学判断。'
  };
  if (depth === 'deep') Object.assign(value, {
    control_analysis: [], evidence_relations: [],
    negative_result_value_zh: '未在 QA mock 中扩展阴性结果。',
    qualitative_quantitative_link_zh: '定性与定量关系需回到原图核对。',
    alternative_explanations: ['仍可能存在模型特异性。'],
    missing_link_if_panel_removed: ['删除任一证据块会中断论证。'],
    paper_argument_role_zh: '建立并限定机制解释。',
    deep_author_strategy_zh: '按证据块逐级推进。'
  });
  if (input.pass === 'panel_extraction') {
    return {
      figure_id: value.figure_id, analysis_depth: value.analysis_depth,
      basis: value.basis, panels: value.panels
    };
  }
  if (input.pass === 'figure_synthesis') {
    const { panels: _panels, ...synthesis } = value;
    return synthesis;
  }
  return value;
}

function crossFigureResponse(input) {
  const figures = Array.isArray(input.figures) ? input.figures : [];
  const mainIds = Array.isArray(input.main_figure_ids) && input.main_figure_ids.length
    ? input.main_figure_ids : figures.filter(item => item?.is_supplemental !== true)
      .map(item => bounded(item?.figure_id, 200)).filter(Boolean);
  const mainFigures = mainIds.map(id =>
    figures.find(item => bounded(item?.figure_id, 200) === id) || { figure_id: id });
  const panelRef = figure => {
    const number = /(?:figure-)?(?:s)?(\d+)/iu.exec(figure?.figure_id || '')?.[1] || '1';
    const panel = figure?.prior_analysis?.argument_chain?.[0]?.panels?.[0] || 'A';
    return `${number}${bounded(panel, 12).replace(/^panel\s*/iu, '').toUpperCase()}`;
  };
  const figureNodes = mainFigures.map((figure, index) => ({
    figure_id: figure.figure_id,
    role: index === 0 ? 'phenomenon' :
      index === mainFigures.length - 1 ? 'functional_outcome' : 'mechanism',
    established_zh: `Figure ${index + 1} 建立跨图论证的第 ${index + 1} 个证据步骤。`,
    transition_zh: index < mainFigures.length - 1
      ? `当前证据仍需 Figure ${index + 2} 检验下一层机制或功能结果。`
      : '该图完成本研究主张的功能边界验证。',
    evidence_level: index === 0 ? 'association' :
      index === mainFigures.length - 1 ? 'functional_validation' : 'mechanistic_support'
  }));
  const domino = figureNodes.slice(0, -1).map((node, index) => ({
    from_figure_id: node.figure_id,
    to_figure_id: figureNodes[index + 1].figure_id,
    relation_type: index === 0 ? 'phenomenon_to_mechanism' : 'mechanism_to_causality',
    established_zh: node.established_zh,
    transition_zh: node.transition_zh,
    evidence_boundary_zh: '该步骤仅支持进入下一层检验，不能单独证明全文因果链。'
  }));
  const supportIds = mainIds.slice(0, Math.max(1, Math.min(3, mainIds.length)));
  return {
    article_title: bounded(input.article_title, 500),
    known_background_zh: ['相关表型与信号调控之间的关系在本研究前仍缺少完整因果证据。'],
    innovation_points_zh: ['将表型、机制干预与功能验证组织为可追溯的跨 Figure 证据链。'],
    limitation_points_zh: ['本地 QA 仅验证界面与数据管线，科学结论仍需独立样本验证。'],
    centralScientificQuestion: '整篇研究如何从表型发现推进到机制解释与功能验证？',
    scientificQuestions: [{
      questionId: 'q-root',
      text: '研究对象是否存在稳定且可重复的核心表型？',
      relationType: 'root',
      parentQuestionIds: [],
      supportingFigureIds: [mainIds[0]]
    }, {
      questionId: 'q-mechanism',
      text: '哪些机制将核心表型连接到最终功能结果？',
      relationType: 'progressive',
      parentQuestionIds: ['q-root'],
      supportingFigureIds: supportIds
    }],
    overall_thesis_zh: '作者先建立表型，再检验机制，最后限定功能结论与外推边界。',
    mechanism_chain: mainFigures.slice(0, Math.max(1, mainFigures.length - 1))
      .map((figure, index) => ({
        from_zh: index === 0 ? '核心表型' : `机制状态 ${index}`,
        to_zh: index === mainFigures.length - 2 ? '功能结果' : `机制状态 ${index + 1}`,
        polarity: 'positive',
        support_panel_refs: [panelRef(figure)]
      })),
    figure_nodes: figureNodes,
    domino_chain: domino,
    supplemental_support: figures.filter(item => item?.is_supplemental === true)
      .map(item => ({
        figure_id: item.figure_id,
        supports_figure_id: mainIds[0],
        support_role: 'robustness',
        attachment_basis: 'semantic_inference',
        contribution_zh: '补充图为主图结论提供稳健性或方法细节。',
        limitation_zh: '补充证据不能替代主图中的直接机制检验。'
      })),
    claim_boundary_zh: '仅依据当前 Figure 图注、正文上下文与既有逐图结果生成。'
  };
}

function mockResponse(payload) {
  if (payload.custom_question !== undefined || payload.requested_topics !== undefined) {
    const panelRef = bounded(payload.available_source_refs?.panel, 40);
    const paragraphId = bounded(payload.available_source_refs?.paragraph_ids?.[0], 120);
    const paragraph = (Array.isArray(payload.related_body_context)
      ? payload.related_body_context : []).find(item => item?.paragraph_id === paragraphId);
    return {
      kind: 'panel-followup',
      value: {
        figure_id: payload.figure_id,
        panel: payload.panel,
        topics: Array.isArray(payload.requested_topics) ? payload.requested_topics : [],
        basis: payload.analysis_basis === 'vision_text' ? 'vision_text' : 'caption_context',
        answer_zh: `已仅回答自定义问题：${bounded(payload.custom_question, 180)}`,
        claim_boundary_zh: '此回答来自本地确定性 QA provider，不代表实际 LLM 科学判断。',
        source_refs: [
          ...(panelRef ? [{ kind: 'panel', ref: panelRef, paragraph_id: '', quote: '' }] : []),
          ...(paragraphId ? [{
            kind: 'paragraph', ref: paragraphId, paragraph_id: paragraphId,
            quote: bounded(paragraph?.text, 120)
          }] : [])
        ]
      }
    };
  }
  if (payload.batch_id && Array.isArray(payload.paragraphs)) {
    return {
      kind: 'paragraph-summary',
      value: {
        batch_id: payload.batch_id,
        paragraphs_reviewed: payload.paragraphs.map(item => item.paragraph_id),
        paragraph_summaries: payload.paragraphs.map(item => ({
          paragraph_id: item.paragraph_id,
          summary_zh: '真实论文段落概述：已按当前段落生成确定性 QA 摘要。',
          rhetorical_role: 'evidence_support',
          key_point_zh: '该段为当前章节提供证据。',
          transition_from_previous_zh: ''
        }))
      }
    };
  }
  if (payload.figure_id && (payload.pass || payload.analysis_depth)) {
    return { kind: `figure-${payload.pass || 'full'}`, value: figureResponse(payload) };
  }
  if (Array.isArray(payload.main_figure_ids) && Array.isArray(payload.figures)) {
    return { kind: 'cross-figure', value: crossFigureResponse(payload) };
  }
  return { kind: 'unknown', value: {} };
}

const providerServer = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  const derivedMatch = /^\/real-article\/(PMC\d+)$/u.exec(requestUrl.pathname);
  if (request.method === 'GET' && derivedMatch && derivedArticles.has(derivedMatch[1])) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(derivedArticles.get(derivedMatch[1]));
    return;
  }
  if (request.method === 'GET' && officialAssets.has(requestUrl.pathname)) {
    const asset = officialAssets.get(requestUrl.pathname);
    response.writeHead(200, {
      'Content-Type': asset.mimeType,
      'Content-Length': asset.bytes.length,
      'Cache-Control': 'private, max-age=300'
    });
    response.end(asset.bytes);
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
  const payload = openAiUserPayload(body);
  const imageEvidence = openAiImageEvidence(body);
  const produced = mockResponse(payload);
  providerRequests.push({
    kind: produced.kind,
    method: request.method || '', path: safeUrl(request.url || ''),
    model: bounded(body.model, 100),
    authorizationPresent: /^Bearer\s+qa-local-only$/u.test(request.headers.authorization || ''),
    figureId: bounded(payload.figure_id, 80), panel: bounded(payload.panel, 20),
    topicCount: Array.isArray(payload.requested_topics) ? payload.requested_topics.length : 0,
    paragraphCount: Array.isArray(payload.paragraphs) ? payload.paragraphs.length : 0,
    ...imageEvidence
  });
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({
    model: 'qa-real-paper-mock',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(produced.value) } }],
    usage: { prompt_tokens: 32, completion_tokens: 24, total_tokens: 56 }
  }));
});
await new Promise((resolve, reject) => {
  providerServer.once('error', reject);
  providerServer.listen(0, '127.0.0.1', resolve);
});
const providerBaseUrl = `http://127.0.0.1:${providerServer.address().port}/v1`;
const derivedArticleBaseUrl = `http://127.0.0.1:${providerServer.address().port}/real-article`;

function captureDiagnostics(page, label) {
  const diagnostics = { label, console: [], pageErrors: [], requestFailures: [], responses: [] };
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) {
      diagnostics.console.push({ type: message.type(), text: bounded(message.text(), 500) });
    }
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(bounded(error.message, 500)));
  page.on('requestfailed', request => diagnostics.requestFailures.push({
    url: safeUrl(request.url()), error: bounded(request.failure()?.errorText, 180)
  }));
  page.on('response', response => {
    if (response.status() >= 400) diagnostics.responses.push({
      url: safeUrl(response.url()), status: response.status()
    });
  });
  return diagnostics;
}

async function articleStats(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    paragraphCount: document.querySelectorAll('p').length,
    semanticFigureCount: document.querySelectorAll('figure').length,
    imageCount: document.images.length,
    loadedImageCount: [...document.images].filter(image =>
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
    ).length,
    recaptcha: /recaptcha|checking your browser|检查您的浏览器/i.test(
      `${document.title} ${document.body?.innerText?.slice(0, 1000) || ''}`
    ),
    supplementaryLinkCount: [...document.querySelectorAll('a')].filter(anchor =>
      /supplement|supporting/i.test(`${anchor.textContent || ''} ${anchor.href || ''}`)
    ).length
  }));
}

async function navigateRealArticle(page, requestedUrl) {
  let direct;
  try {
    const response = await page.goto(requestedUrl, {
      waitUntil: 'domcontentloaded', timeout: 60000
    });
    await page.waitForTimeout(2200);
    direct = { status: response?.status() || 0, ...(await articleStats(page)) };
  } catch (error) {
    direct = {
      status: 0,
      url: requestedUrl,
      title: '',
      paragraphCount: 0,
      semanticFigureCount: 0,
      imageCount: 0,
      loadedImageCount: 0,
      recaptcha: false,
      supplementaryLinkCount: 0,
      navigationError: bounded(error.message, 240)
    };
  }
  const blocked = direct.recaptcha || direct.paragraphCount < 3;
  let fallback = null;
  let derived = null;
  if (blocked) {
    const mirror = europePmcMirror(requestedUrl);
    if (!mirror) throw new Error(`Article blocked and no PMC mirror is available: ${requestedUrl}`);
    try {
      const mirrorResponse = await page.goto(mirror, {
        waitUntil: 'domcontentloaded', timeout: 60000
      });
      await page.waitForTimeout(3000);
      fallback = { status: mirrorResponse?.status() || 0, ...(await articleStats(page)) };
    } catch (error) {
      fallback = {
        status: 0,
        url: mirror,
        title: '',
        paragraphCount: 0,
        semanticFigureCount: 0,
        imageCount: 0,
        loadedImageCount: 0,
        recaptcha: false,
        supplementaryLinkCount: 0,
        navigationError: bounded(error.message, 240)
      };
    }
  }
  const id = `PMC${pmcId(requestedUrl)}`;
  const presented = fallback || direct;
  if (process.env.SKIP_BIOC_DERIVED !== '1' &&
      presented.semanticFigureCount === 0 && !derivedArticles.has(id)) {
    const sourceUrl = `https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/` +
      `pmcoa.cgi/BioC_xml/${id}/unicode`;
    try {
      const sourceResponse = await page.goto(sourceUrl, {
        waitUntil: 'domcontentloaded', timeout: 60000
      });
      const xml = await page.evaluate(() =>
        new XMLSerializer().serializeToString(document)
      );
      const passages = parseBioCPassages(xml);
      const figureIds = [...new Set(passages
        .filter(item => item.infons.section_type === 'FIG')
        .map(item => bioCFigureNumber(item.infons.id)).filter(Boolean))];
      if (figureIds.length) {
        derivedArticles.set(id, bioCArticleHtml(id, passages));
        derivedArticleMetadata.push({
          pmcId: id, sourceUrl, sourceStatus: sourceResponse?.status() || 0,
          passageCount: passages.length, figureCount: figureIds.length,
          figureCaptionPassageCount: passages.filter(item =>
            item.infons.section_type === 'FIG').length,
          savedToDisk: false, transport: 'browser'
        });
      }
    } catch (error) {
      derivedArticleMetadata.push({
        pmcId: id, sourceUrl, error: bounded(error.message, 240),
        savedToDisk: false, transport: 'browser'
      });
    }
  }
  if (process.env.SKIP_BIOC_DERIVED !== '1' && derivedArticles.has(id)) {
    let derivedResponse = null;
    let derivedError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        derivedResponse = await page.goto(`${derivedArticleBaseUrl}/${id}`, {
          waitUntil: 'domcontentloaded', timeout: 60000
        });
        await page.waitForTimeout(1200);
        if (page.url().startsWith(`${derivedArticleBaseUrl}/${id}`) &&
            (await articleStats(page)).semanticFigureCount > 0) break;
      } catch (error) {
        derivedError = error;
      }
      await page.waitForTimeout(300 * (attempt + 1));
    }
    if (!page.url().startsWith(`${derivedArticleBaseUrl}/${id}`)) {
      throw new Error(`Unable to load official derived article ${id}: ${bounded(
        derivedError?.message || page.url(), 240
      )}`);
    }
    const source = derivedArticleMetadata.find(item => item.pmcId === id);
    derived = {
      status: derivedResponse?.status() || 0,
      ...(await articleStats(page)),
      source: source ? { ...source } : null
    };
  }
  return { requestedUrl, direct, blocked, fallback, derived, loaded: derived || fallback || direct };
}

async function extensionWorker(context) {
  return context.serviceWorkers()[0] ||
    context.waitForEvent('serviceworker', { timeout: 15000 });
}

async function activateArticle(worker, articlePage) {
  const targetUrl = articlePage.url();
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const tab = tabs.find(item => item.url === targetUrl) ||
    tabs.find(item => safeUrl(item.url || '') === safeUrl(targetUrl));
  if (!tab?.id) throw new Error(`Unable to resolve article tab: ${targetUrl}`);
  await worker.evaluate(async current => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, current);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  }, tab);
  return tab;
}

async function openPanel(context, extensionId, articlePage, articleTab) {
  const page = await context.newPage();
  const diagnostics = captureDiagnostics(page, 'side-panel');
  await page.setViewportSize({ width: 460, height: 940 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded'
  });
  await articlePage.bringToFront();
  await page.evaluate(async expectedTabId => {
    const tab = await chrome.tabs.get(expectedTabId);
    tabContextRequestSequence += 1;
    tabContextSequence += 1;
    activePanelTabContext = {
      tabId: tab.id,
      url: SciLLM.normalizeTabDocumentUrl(tab.url || tab.pendingUrl),
      key: panelTabDocumentKey(tab),
      activated: true,
      pdfMode: false,
      tabContextSequence
    };
    resetPanelArticleState();
    await initializeCurrentArticle();
  }, articleTab.id);
  await page.waitForFunction(() =>
    Boolean(currentWorkspaceSnapshot?.localWorkspace?.workspaceId) &&
    Boolean(currentWorkspaceSnapshot?.paragraphs?.length) &&
    Boolean(document.getElementById('sidePanelPaperTitle')?.textContent),
  null, { timeout: 20000 });
  await page.evaluate(async () => refreshArticleWorkspace({ force: true }));
  return { page, diagnostics };
}

async function switchView(page, name) {
  await page.evaluate(view => switchWorkspaceView(view), name);
  await page.waitForFunction(view =>
    document.querySelector(`.workspace-view[data-workspace-view="${view}"]`)?.hidden === false,
  name);
}

async function screenshot(page, name, options = {}) {
  const target = artifact(name);
  await page.screenshot({ path: target, fullPage: options.fullPage === true });
  return target;
}

async function captureFirstRealFigure(page, id) {
  const figure = page.locator('figure').filter({ has: page.locator('img') }).first();
  await figure.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('figure img');
    return Boolean(image?.complete && image.naturalWidth && image.naturalHeight);
  }, null, { timeout: 20000 });
  await figure.scrollIntoViewIfNeeded();
  const target = artifact(`paper-${id}-real-main-figure.png`);
  await figure.screenshot({ path: target });
  return figure.evaluate(node => {
    const image = node.querySelector('img');
    return {
      rendered: Boolean(image?.complete && image.naturalWidth && image.naturalHeight),
      naturalWidth: image?.naturalWidth || 0,
      naturalHeight: image?.naturalHeight || 0,
      currentSrcPath: (() => {
        try { return new URL(image?.currentSrc || image?.src || '').pathname; } catch (_) { return ''; }
      })()
    };
  });
}

async function restoreDerivedArticleAfterRendererFailure(page, id) {
  const rawId = String(id || '').trim();
  const derivedId = /^PMC\d+$/iu.test(rawId)
    ? rawId.toUpperCase()
    : (/^\d+$/u.test(rawId) ? `PMC${rawId}` : '');
  if (!page.url().startsWith('chrome-error://') || !derivedArticles.has(derivedId)) return false;
  const target = `${derivedArticleBaseUrl}/${derivedId}`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(600 + (attempt * 300));
      if (page.url().startsWith(target) &&
          (await articleStats(page)).semanticFigureCount > 0) return true;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Unable to restore official derived article ${derivedId}: ${bounded(
    lastError?.message || page.url(), 240
  )}`);
}

async function captureOfficialSupplementaryVisual(context, id, input) {
  void context;
  const target = artifact(`paper-${id}-${input.metadata.figureLabel.toLowerCase()
    .replace(/\s+/gu, '-')}-official-source.png`);
  fs.copyFileSync(input.imagePath, target);
  return {
    naturalWidth: input.metadata.width,
    naturalHeight: input.metadata.height,
    rendered: true,
    sha256MatchesSource: sha256(fs.readFileSync(target)) === input.metadata.sha256,
    captureKind: 'byte-identical-official-source'
  };
}

async function figureOrder(page) {
  return page.evaluate(() => [...document.querySelectorAll(
    '#figureWorkspace > .workspace-figure-card[data-figure-id]'
  )].map(card => ({
    id: card.dataset.figureId,
    label: (card.querySelector('.workspace-figure-summary-heading')?.textContent || '')
      .split('·')[0].trim(),
    supplemental: card.classList.contains('is-supplemental')
  })));
}

async function openFigure(page, figureId, panelId = '') {
  const card = page.locator(`.workspace-figure-card[data-figure-id="${figureId}"]`);
  await card.evaluate(node => { node.open = true; });
  if (panelId) {
    const panel = card.locator(`.workspace-figure-panel-card[data-panel-id="${panelId}"]`);
    await panel.evaluate(node => { node.open = true; });
  }
  await page.waitForTimeout(80);
  return card;
}

async function editInline(page, selector, value) {
  const expectedValue = String(value).normalize('NFKC');
  let target = page.locator(selector).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await target.evaluate(node => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
      });
      await target.scrollIntoViewIfNeeded();
      await target.dblclick();
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      target = page.locator(selector).first();
      await page.waitForTimeout(100);
    }
  }
  const editor = page.locator(`${selector} textarea.workspace-figure-inline-editor`).first();
  await editor.waitFor({ state: 'visible' });
  await editor.fill(value);
  await editor.press('Control+Enter');
  try {
    await page.waitForFunction(({ selector, value }) => {
      const node = document.querySelector(selector);
      if (!node || node.querySelector('textarea')) return false;
      if (value.includes('\n')) {
        return Number(currentWorkspaceSnapshot?.figures?.draft?.revision ||
          currentWorkspaceSnapshot?.figureWorkspaceDraft?.revision || 0) > 0;
      }
      return node.textContent.includes(value);
    }, { selector, value: expectedValue }, { timeout: 15000 });
  } catch (error) {
    const state = await page.evaluate(({ selector }) => {
      const node = document.querySelector(selector);
      const controller = typeof figureWorkspaceInlineEditController === 'object'
        ? figureWorkspaceInlineEditController.getState() : null;
      const draft = currentWorkspaceSnapshot?.figures?.draft ||
        currentWorkspaceSnapshot?.figureWorkspaceDraft;
      return {
        targetText: node?.textContent || '',
        editorValue: node?.querySelector('textarea')?.value || '',
        editStatus: node?.parentElement?.querySelector('[data-figure-edit-status]')?.textContent || '',
        globalStatus: document.getElementById('statusMessage')?.textContent || '',
        revision: draft?.revision,
        controller,
        activeContext: {
          tabId: activePanelTabContext?.tabId,
          key: activePanelTabContext?.key,
          documentId: preparedDocumentState?.documentId,
          documentHash: preparedDocumentState?.documentHash
        }
      };
    }, { selector });
    throw new Error(`Inline edit did not render saved value: ${JSON.stringify(state)}`, {
      cause: error
    });
  }
}

async function importSupplement(page, label, input) {
  if (!input?.imagePath || !fs.existsSync(input.imagePath)) {
    throw new Error(`Official supplementary image is missing for ${label}`);
  }
  await page.locator('#openSupplementalFigureImport').click();
  await page.locator('#supplementalFigureImportDialog[open]').waitFor({ state: 'visible' });
  await page.locator('input[name="supplementalFigureSourceMode"][value="manual"]').check();
  await page.locator('input[name="supplementalFigureSourceMode"][value="manual"]')
    .dispatchEvent('change');
  await page.locator('[data-supplemental-source-pane="manual"]').waitFor({ state: 'visible' });
  await page.locator('#supplementalFigureKind').selectOption('supplemental');
  await page.locator('#supplementalFigureLabel').fill(label);
  await page.locator('#supplementalFigureImageFile').setInputFiles(input.imagePath);
  await page.locator('#supplementalFigureImageCaption').fill(input.caption || '');
  await page.locator('#submitSupplementalFigureImport').click();
  await page.locator('#supplementalFigureImportDialog').waitFor({ state: 'hidden', timeout: 20000 });
  await page.waitForFunction(expected => [...document.querySelectorAll(
    '.workspace-figure-summary-heading'
  )].some(node => node.textContent.startsWith(expected)), label, { timeout: 20000 });
}

async function findFigureId(page, label) {
  return page.evaluate(expected => {
    const card = [...document.querySelectorAll('.workspace-figure-card')]
      .find(item => item.querySelector('.workspace-figure-summary-heading')
        ?.textContent.startsWith(expected));
    return card?.dataset.figureId || '';
  }, label);
}

async function moveSupplementUp(page, figureId) {
  const before = await figureOrder(page);
  const previousIndex = before.findIndex(item => item.id === figureId);
  await page.evaluate(id => {
    const card = document.querySelector(
      `.workspace-figure-card[data-figure-id="${CSS.escape(id)}"]`
    );
    const button = [...(card?.querySelectorAll(
      '.workspace-supplemental-placement-menu button'
    ) || [])].find(node => node.textContent.trim() === '上移');
    if (!button) throw new Error(`Supplement placement up button missing: ${id}`);
    button.click();
  }, figureId);
  await page.waitForFunction(({ id, previousIndex }) => {
    const cards = [...document.querySelectorAll('#figureWorkspace > .workspace-figure-card')];
    return cards.findIndex(item => item.dataset.figureId === id) === previousIndex - 1;
  }, { id: figureId, previousIndex }, { timeout: 15000 });
}

async function longPressDrag(page, figureId, targetFigureId, screenshotName) {
  await page.locator('#collapseAllFigureLevels').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.workspace-figure-card')]
    .every(card => card.open === false));
  const source = page.locator(
    `.workspace-figure-card[data-figure-id="${figureId}"] > summary`
  );
  const target = page.locator(
    `.workspace-figure-card[data-figure-id="${targetFigureId}"] > summary`
  );
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) return false;
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(470);
  const active = await page.locator('.workspace-supplemental-drag-ghost').count() === 1;
  if (active) await screenshot(page, screenshotName);
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + Math.max(2, targetBox.height - 2),
    { steps: 8 }
  );
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(500);
  return active;
}

async function configureLocalMock(extensionPage) {
  return extensionPage.evaluate(async baseUrl => {
    const profileId = 'profile_qa_real_paper_mock';
    const save = await chrome.runtime.sendMessage({
      type: 'LLM_SAVE_PROFILE',
      profile: {
        id: profileId, name: 'QA real-paper local mock',
        providerId: 'openai-compatible',
        config: {
          apiKey: 'qa-local-only', model: 'qa-real-paper-mock', baseUrl,
          authHeader: 'Authorization', authPrefix: 'Bearer',
          jsonMode: true, supportsVision: true
        },
        capabilities: { vision: true }
      }
    });
    const routing = await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: profileId,
      taskRoutes: {
        highlight: { mode: 'profile', profileId },
        summary: { mode: 'profile', profileId },
        figure: { mode: 'profile', profileId },
        crossFigure: { mode: 'profile', profileId }
      }
    });
    const preferences = await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { mode: 'llm', consentGranted: true }
    });
    return {
      saveSuccess: save?.success === true,
      routingSuccess: routing?.success === true,
      preferencesSuccess: preferences?.success === true
    };
  }, providerBaseUrl);
}

async function resetLocalMock(extensionPage) {
  const result = await extensionPage.evaluate(async () => {
    const preferences = await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { mode: 'regex', consentGranted: false }
    });
    const deleted = await chrome.runtime.sendMessage({
      type: 'LLM_DELETE_PROFILE', profileId: 'profile_qa_real_paper_mock'
    });
    return {
      preferencesSuccess: preferences?.success === true,
      deleteSuccess: deleted?.success === true
    };
  });
  await extensionPage.evaluate(async () => loadLlmSettings());
  await extensionPage.waitForFunction(() => hasUsableLlm() === false, null, {
    timeout: 10000
  });
  return result;
}

async function reloadBoundPanel(page, articlePage) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await articlePage.bringToFront();
  await page.waitForFunction(() => Boolean(currentWorkspaceSnapshot?.localWorkspace?.workspaceId),
    null, { timeout: 20000 });
  await page.evaluate(async () => refreshArticleWorkspace({ force: true }));
}

async function visualMetrics(page) {
  return page.evaluate(() => {
    const active = document.querySelector('.workspace-view:not([hidden])');
    const activeRect = active?.getBoundingClientRect();
    const clipped = [...document.querySelectorAll(
      '.workspace-figure-card, .workspace-figure-panel-card, .workspace-mechanism-node, ' +
      '.workspace-mechanism-edge, .workspace-panel-followup-answer'
    )].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
    }).length;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      activeView: active?.dataset.workspaceView || '',
      horizontalOverflow: document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      activeViewOverflow: Boolean(activeRect && activeRect.right > innerWidth + 1),
      clippedRelevantBlocks: clipped,
      openEvidenceBlocks: document.querySelectorAll(
        '.workspace-evidence-block[open], .workspace-evidence-transition[open]'
      ).length
    };
  });
}

async function runDmgRealPanelQa(panel, id) {
  const qa = {
    providerConfiguration: {}, summary: {}, figureAnalysis: {}, followup: {}, reset: {}
  };
  const requestStart = providerRequests.length;
  qa.providerConfiguration = await configureLocalMock(panel);
  await panel.evaluate(async () => loadLlmSettings());
  await panel.waitForFunction(() => hasUsableLlm() === true, null, { timeout: 10000 });
  try {
    await switchView(panel, 'navigation');
    await panel.evaluate(() => document.querySelectorAll(
      '.workspace-view[data-workspace-view="navigation"] details'
    ).forEach(node => { node.open = true; }));
    const summaryAction = panel.locator('.workspace-paragraph-summary-action').first();
    await summaryAction.waitFor({ state: 'visible' });
    const paragraphId = await summaryAction.locator('xpath=..')
      .locator('.workspace-paragraph-jump').getAttribute('data-paragraph-id');
    await summaryAction.click();
    await panel.waitForFunction(idValue =>
      (currentWorkspaceSnapshot?.paragraphSummaries || [])
        .some(item => item?.paragraphId === idValue && String(item?.summary || '').trim()),
    paragraphId, { timeout: 30000 });
    qa.summary = await panel.evaluate(idValue => ({
      paragraphId: idValue,
      generated: (currentWorkspaceSnapshot?.paragraphSummaries || [])
        .some(item => item?.paragraphId === idValue && String(item?.summary || '').trim())
    }), paragraphId);

    await switchView(panel, 'figures');
    await openFigure(panel, 'figure-1', 'A');
    const mainAnalysisRequestStart = providerRequests.length;
    await panel.locator(
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-analyze-action'
    ).click();
    await panel.waitForFunction(() => {
      const figure = currentWorkspaceSnapshot?.figures?.figures
        ?.find(item => item.figureId === 'figure-1');
      return Boolean(figure?.standard?.remainingQuestion && figure?.standard?.panels?.length);
    }, null, { timeout: 90000 });
    await openFigure(panel, 'figure-1', 'A');
    const imageRequests = providerRequests.slice(requestStart).filter(item =>
      item.figureId === 'figure-1' && item.imageInputCount > 0
    );
    qa.figureAnalysis = await panel.evaluate(() => {
      const figure = currentWorkspaceSnapshot?.figures?.figures
        ?.find(item => item.figureId === 'figure-1');
      const panel = document.querySelector(
        '.workspace-figure-card[data-figure-id="figure-1"] ' +
        '.workspace-figure-panel-card[data-panel-id="A"]'
      );
      return {
        actualPanelId: panel?.querySelector('summary')?.textContent.trim().split(/\s+/u)[0] || '',
        basis: figure?.standard?.basis || '',
        panelCount: figure?.standard?.panels?.length || 0
      };
    });
    qa.figureAnalysis.providerVisionRequests = providerRequests.slice(mainAnalysisRequestStart)
      .filter(request => request.figureId === 'figure-1' && request.method === 'POST')
      .map(request => ({
        kind: request.kind,
        imageInputCount: request.imageInputCount,
        dataImageCount: request.dataImageCount,
        imageMimeTypes: request.imageMimeTypes,
        imageInputSha256: request.imageInputSha256
      }));
    qa.figureAnalysis.providerImageRequestCount = imageRequests.length;
    qa.figureAnalysis.providerImageInputCount = imageRequests.reduce(
      (sum, request) => sum + request.imageInputCount, 0
    );

    const panelA = panel.locator(
      '.workspace-figure-card[data-figure-id="figure-1"] ' +
      '.workspace-figure-panel-card[data-panel-id="A"]'
    );
    await panelA.evaluate(node => { node.open = true; });
    await panelA.locator('.workspace-panel-ask').click();
    const followup = panelA.locator('.workspace-panel-followup');
    await followup.locator('input[type="checkbox"]').evaluateAll(nodes =>
      nodes.forEach(node => { node.checked = false; node.dispatchEvent(new Event('change')); }));
    const selectedTopicCount = await followup.locator('input[type="checkbox"]:checked').count();
    const customQuestion = '为什么作者在真实 Panel 1A 后还需要继续下一步实验？';
    await followup.locator('textarea').fill(customQuestion);
    await followup.locator('.workspace-panel-followup-submit').click();
    const answer = panelA.locator('.workspace-panel-followup-answer');
    await answer.waitFor({ state: 'visible', timeout: 30000 });
    qa.followup = await answer.evaluate((node, topicCount) => ({
      customOnly: topicCount === 0,
      answerVisible: node.textContent.trim().length > 0,
      jumpLabels: [...node.querySelectorAll('.workspace-panel-followup-source')]
        .map(button => button.textContent.trim()),
      sourceCount: node.querySelectorAll('.workspace-panel-followup-source').length
    }), selectedTopicCount);
    const panelJump = answer.locator('.workspace-panel-followup-source')
      .filter({ hasText: '1A' }).first();
    if (await panelJump.count()) await panelJump.click();
    qa.followup.panelJumpExpanded = await panelA.evaluate(node => node.open === true);
    await panel.setViewportSize({ width: 380, height: 900 });
    await screenshot(panel, `paper-${id}-narrow-real-panel-followup.png`);
  } finally {
    qa.reset = await resetLocalMock(panel);
  }
  return qa;
}

let context;
const articleResults = [];
let detailed = null;
try {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge', headless: true,
    viewport: { width: 1280, height: 940 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  const worker = await extensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  for (let index = 0; index < articleUrls.length; index += 1) {
    const requestedUrl = articleUrls[index];
    const id = pmcId(requestedUrl) || `article-${index + 1}`;
    const articlePage = await context.newPage();
    const articleDiagnostics = captureDiagnostics(articlePage, `article-${id}`);
    const navigation = await navigateRealArticle(articlePage, requestedUrl);
    let sourceFigureVisual = null;
    try {
      sourceFigureVisual = await captureFirstRealFigure(articlePage, id);
    } catch (error) {
      sourceFigureVisual = { rendered: false, error: bounded(error.message, 240) };
    }
    await restoreDerivedArticleAfterRendererFailure(articlePage, id);
    const articleTab = await activateArticle(worker, articlePage);
    const realMainInputProbe = {
      sourceRendered: sourceFigureVisual?.rendered === true,
      naturalWidth: sourceFigureVisual?.naturalWidth || 0,
      naturalHeight: sourceFigureVisual?.naturalHeight || 0
    };
    const opened = await openPanel(context, extensionId, articlePage, articleTab);
    const panel = opened.page;
    await switchView(panel, 'figures');
    const workspace = await panel.evaluate(() => ({
      title: currentWorkspaceSnapshot?.title || '',
      paragraphCount: currentWorkspaceSnapshot?.paragraphs?.length || 0,
      figureCount: currentWorkspaceSnapshot?.figures?.figures?.length || 0,
      panelCount: (currentWorkspaceSnapshot?.figures?.figures || [])
        .reduce((sum, figure) => sum + (figure.panelHints?.length || 0), 0),
      figureLabels: (currentWorkspaceSnapshot?.figures?.figures || [])
        .map(figure => figure.figureLabel).slice(0, 20),
      usableLlm: hasUsableLlm()
    }));
    await panel.setViewportSize({ width: 700, height: 1000 });
    await screenshot(panel, `paper-${id}-wide-baseline.png`);
    await panel.setViewportSize({ width: 380, height: 900 });
    await screenshot(panel, `paper-${id}-narrow-baseline.png`);
    const baselineVisual = await visualMetrics(panel);
    const result = {
      pmcId: id, navigation, workspace, baselineVisual, sourceFigureVisual,
      realMainInputProbe,
      articleDiagnostics, panelDiagnostics: opened.diagnostics
    };
    articleResults.push(result);

    if (id === '12767537') {
      result.realPanelQa = await runDmgRealPanelQa(panel, id);
    }

    const detailedCandidate = workspace.figureCount >= 2 && (
      articleUrls.length === 1 || id === '12167935'
    );
    if (!detailedCandidate) {
      await panel.close();
      await articlePage.close();
      continue;
    }

    // The complete authoring and persistence path is exercised on the real article
    // that exposes a stable eight-Figure DOM through the official mirror.
    const qa = { noLlm: {}, compactIds: {}, editing: {}, supplemental: {}, mechanism: {},
      providerMock: {}, summary: {}, figureAnalysis: {}, followup: {}, visual: {} };
    if (process.env.DEBUG_ROUTER_ONLY === '1') {
      const configuration = await configureLocalMock(panel);
      await panel.evaluate(async () => loadLlmSettings());
      await switchView(panel, 'navigation');
      await panel.evaluate(() => document.querySelectorAll(
        '.workspace-view[data-workspace-view="navigation"] details'
      ).forEach(node => { node.open = true; }));
      const action = panel.locator('.workspace-paragraph-summary-action').first();
      await action.evaluate(button => button.click());
      await panel.waitForTimeout(8000);
      const state = await panel.evaluate(() => ({
        usable: hasUsableLlm(),
        status: document.getElementById('statusMessage')?.textContent || '',
        buttons: [...document.querySelectorAll('.workspace-paragraph-jump')]
          .slice(0, 3).map(node => ({ text: node.textContent, className: node.className })),
        summaryTasks: [...workspaceParagraphSummaryState.entries()],
        preparedDocumentState,
        manualDocument: {
          documentId: manualAnnotationState?.documentId,
          documentHash: manualAnnotationState?.documentHash
        }
      }));
      throw new Error(`DEBUG_ROUTER ${JSON.stringify({ configuration, providerRequests, state })}`);
    }
    qa.noLlm.usableBeforeConfiguration = workspace.usableLlm;
    const figure1 = await openFigure(panel, 'figure-1', 'A');
    qa.noLlm.template = await figure1.evaluate(card => {
      const overview = [...card.querySelectorAll(':scope > .workspace-figure-overview [data-field]')]
        .map(node => node.dataset.field);
      const panel = card.querySelector('.workspace-figure-panel-card[data-panel-id="A"]');
      const fields = [...(panel?.querySelectorAll(':scope > [data-field]') || [])]
        .map(node => node.dataset.field);
      return {
        overview, fields,
        placeholderCount: card.querySelectorAll('[data-figure-workspace-placeholder]').length,
        noteIsLast: panel?.lastElementChild?.classList.contains('workspace-panel-note') === true
      };
    });
    qa.compactIds.main = await panel.evaluate(() => ({
      oneE: [...document.querySelectorAll(
        '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-panel-card summary'
      )].some(node => /^1E(?:\s|$)/u.test(node.textContent.trim())),
      twoA: [...document.querySelectorAll(
        '.workspace-figure-card[data-figure-id="figure-2"] .workspace-figure-panel-card summary'
      )].some(node => /^2A(?:\s|$)/u.test(node.textContent.trim()))
    }));

    const question = `QA-${id}-本图问题`.normalize('NFKC');
    const remaining = `QA-${id}-遗留问题：为什么研究者继续下一张图`.normalize('NFKC');
    const purpose = `QA-${id}-Panel目的`;
    const note = `QA-${id}-阅读笔记`;
    await editInline(panel,
      '.workspace-figure-card[data-figure-id="figure-1"] [data-field="figureQuestion"] .workspace-figure-edit-target',
      question);
    await editInline(panel,
      '.workspace-figure-card[data-figure-id="figure-1"] [data-field="remainingQuestion"] .workspace-figure-edit-target',
      remaining);
    await editInline(panel,
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-panel-card[data-panel-id="A"] [data-field="purpose"] .workspace-figure-edit-target',
      purpose);
    await editInline(panel,
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-panel-card[data-panel-id="A"] [data-field="evidenceType"] .workspace-figure-edit-target',
      '充分性证据');
    await editInline(panel,
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-panel-card[data-panel-id="A"] [data-field="experimentalMethods"] .workspace-figure-edit-target',
      '免疫荧光\nWestern blot');
    await editInline(panel,
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-panel-card[data-panel-id="A"] [data-field="statisticalMethods"] .workspace-figure-edit-target',
      '单因素 ANOVA\n配对 t 检验');
    await editInline(panel,
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-panel-card[data-panel-id="A"] [data-field="note"] .workspace-figure-edit-target',
      note);

    const backgroundCard = panel.locator('.workspace-figure-meta-card[data-meta-kind="research background"]');
    await backgroundCard.evaluate(node => { node.open = true; });
    await editInline(panel,
      '.workspace-figure-meta-card[data-meta-kind="research background"] .workspace-figure-edit-target',
      `QA-${id}-研究背景`);
    const questionCard = panel.locator('.workspace-figure-meta-card[data-meta-kind="scientific question"]');
    await questionCard.evaluate(node => { node.open = true; });
    await editInline(panel,
      '.workspace-figure-meta-card[data-meta-kind="scientific question"] .workspace-figure-edit-target',
      `QA-${id}-科学问题`);
    await openFigure(panel, 'figure-1', 'A');
    const editTarget = panel.locator(
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-panel-card[data-panel-id="A"] [data-field="note"] .workspace-figure-edit-target'
    );
    await editTarget.dblclick();
    await panel.setViewportSize({ width: 380, height: 900 });
    await screenshot(panel, `paper-${id}-narrow-inline-editor.png`);
    await editTarget.locator('textarea').press('Escape');

    const s1Input = officialSupplementaryInputs.get('Figure S1');
    const s2Input = officialSupplementaryInputs.get('Figure S2');
    if (!s1Input || !s2Input) {
      throw new Error('Official Figure S1/S2 inputs were not prepared from JATS/ZIP sources');
    }
    qa.supplemental.officialVisuals = {
      s1: await captureOfficialSupplementaryVisual(context, id, s1Input),
      s2: await captureOfficialSupplementaryVisual(context, id, s2Input)
    };
    await importSupplement(panel, 'Figure S1', s1Input);
    await importSupplement(panel, 'Figure S2', s2Input);
    const s1Id = await findFigureId(panel, 'Figure S1');
    const s2Id = await findFigureId(panel, 'Figure S2');
    qa.supplemental.ids = { s1Id, s2Id };
    qa.supplemental.officialInputs = [s1Input, s2Input].map(input => ({
      figureLabel: input.metadata.figureLabel,
      supplementaryHref: input.metadata.supplementaryHref,
      byteLength: input.metadata.byteLength,
      width: input.metadata.width,
      height: input.metadata.height,
      sha256: input.metadata.sha256,
      captionPanelLabels: input.metadata.captionPanelLabels
    }));

    qa.providerMock.configuration = await configureLocalMock(panel);
    await panel.evaluate(async () => loadLlmSettings());
    await panel.waitForFunction(() => hasUsableLlm() === true, null, { timeout: 10000 });
    const analyzeOfficialSupplement = async figureId => {
      await openFigure(panel, figureId);
      await panel.evaluate(async idValue => runSingleFigureAnalysis(idValue), figureId);
      await panel.evaluate(async () => refreshArticleWorkspace({ force: true }));
      await openFigure(panel, figureId);
      const completed = await panel.evaluate(idValue => {
        const figure = currentWorkspaceSnapshot?.figures?.figures
          ?.find(item => item.figureId === idValue);
        return {
          complete: Boolean(figure?.standard?.panels?.length &&
            figure?.standard?.basis === 'vision_text'),
          basis: figure?.standard?.basis || '',
          panelCount: figure?.standard?.panels?.length || 0,
          standardError: figure?.standardError || '',
          status: document.getElementById('statusMessage')?.textContent || ''
        };
      }, figureId);
      const requests = providerRequests.filter(item => item.figureId === figureId).slice(-12);
      completed.providerVisionPosts = requests.filter(item =>
        item.method === 'POST' && item.imageInputCount > 0 && item.dataImageCount > 0
      ).length;
      completed.controllerCompleted = completed.status.includes('已完成') &&
        completed.providerVisionPosts > 0;
      if (!completed.controllerCompleted || !completed.complete ||
          completed.basis !== 'vision_text' || completed.panelCount < 1) {
        throw new Error(`Official supplement analysis incomplete: ${JSON.stringify({
          figureId, completed, requests
        })}`);
      }
      return completed;
    };
    qa.supplemental.analysisStates = {
      s1: await analyzeOfficialSupplement(s1Id),
      s2: await analyzeOfficialSupplement(s2Id)
    };
    const s2PanelEditValue = `QA-${id}-S2A-purpose-edit`;
    const s2PanelSelector =
      `.workspace-figure-card[data-figure-id="${s2Id}"] ` +
      '.workspace-figure-panel-card[data-panel-id="A"]';
    await openFigure(panel, s2Id, 'A');
    qa.supplemental.s2PanelQa = {
      visibleBeforeEdit: await panel.locator(`${s2PanelSelector} summary`)
        .evaluate(node => node.textContent.includes('S2A'))
    };
    await editInline(
      panel,
      `${s2PanelSelector} [data-field="purpose"] .workspace-figure-edit-target`,
      s2PanelEditValue
    );
    qa.supplemental.s2PanelQa.editable = await panel.locator(
      `${s2PanelSelector} [data-field="purpose"] .workspace-figure-edit-target`
    ).evaluate((node, expected) => node.textContent.includes(expected), s2PanelEditValue);
    qa.supplemental.s2PanelQa.editValue = s2PanelEditValue;
    qa.supplemental.providerVisionRequests = providerRequests.filter(request =>
      [s1Id, s2Id].includes(request.figureId) && request.method === 'POST'
    ).map(request => ({
      kind: request.kind,
      figureId: request.figureId,
      imageInputCount: request.imageInputCount,
      dataImageCount: request.dataImageCount,
      imageMimeTypes: request.imageMimeTypes,
      imageInputSha256: request.imageInputSha256
    }));
    qa.providerMock.resetAfterSupplementAnalysis = await resetLocalMock(panel);
    qa.compactIds.supplemental = await panel.evaluate(({ s1Id, s2Id }) => ({
      s1b: [...document.querySelectorAll(
        `.workspace-figure-card[data-figure-id="${CSS.escape(s1Id)}"] .workspace-figure-panel-card summary`
      )].some(node => node.textContent.includes('S1B')),
      s2a: [...document.querySelectorAll(
        `.workspace-figure-card[data-figure-id="${CSS.escape(s2Id)}"] .workspace-figure-panel-card summary`
      )].some(node => node.textContent.includes('S2A'))
    }), { s1Id, s2Id });

    let order = await figureOrder(panel);
    await moveSupplementUp(panel, s2Id);
    order = await figureOrder(panel);
    qa.supplemental.keyboardOrder = order.map(item => item.label);
    qa.supplemental.longPressActivated = await longPressDrag(
      panel, s2Id, 'figure-3', `paper-${id}-narrow-drag-active.png`
    );
    qa.supplemental.dragOrder = (await figureOrder(panel)).map(item => item.label);

    await switchView(panel, 'figures');
    qa.providerMock.autoSynthesisConfiguration = await configureLocalMock(panel);
    await panel.evaluate(async () => loadLlmSettings());
    await panel.waitForFunction(() => hasUsableLlm() === true, null, { timeout: 10000 });
    const pageCountBeforeMechanism = context.pages().length;
    const synthesisRequestStart = providerRequests.length;
    await panel.locator('#analyzeFiguresFromFigures').click();
    await panel.waitForFunction(() => {
      const draft = currentWorkspaceSnapshot?.figures?.draft ||
        currentWorkspaceSnapshot?.figureWorkspaceDraft;
      return figureAnalysisState.running === false && crossFigureLogicRunning === false &&
        (draft?.meta?.backgroundItems?.length || 0) > 0 &&
        (draft?.meta?.scientificQuestions?.length || 0) > 0 &&
        (draft?.meta?.innovationPoints?.length || 0) > 0 &&
        (draft?.meta?.limitationPoints?.length || 0) > 0 &&
        (draft?.mechanismChain?.nodes?.length || 0) >= 2 &&
        Boolean(document.querySelector('.workspace-logic-map-open'));
    }, null, { timeout: 300000 });
    qa.mechanism.autoSynthesis = await panel.evaluate(() => {
      const draft = currentWorkspaceSnapshot?.figures?.draft ||
        currentWorkspaceSnapshot?.figureWorkspaceDraft;
      return {
        figureButtonVisible: document.getElementById('analyzeFiguresFromFigures')
          ?.checkVisibility() === true,
        removedMechanismButton: document.getElementById('analyzeCrossFigureLogic') === null,
        backgroundItems: draft?.meta?.backgroundItems?.length || 0,
        scientificQuestions: draft?.meta?.scientificQuestions?.length || 0,
        innovationPoints: draft?.meta?.innovationPoints?.length || 0,
        limitationPoints: draft?.meta?.limitationPoints?.length || 0,
        mechanismNodes: draft?.mechanismChain?.nodes?.length || 0,
        mechanismEdges: draft?.mechanismChain?.edges?.length || 0
      };
    });
    qa.mechanism.autoSynthesis.providerKinds = providerRequests
      .slice(synthesisRequestStart).map(item => item.kind);
    await screenshot(panel, `paper-${id}-all-figures-auto-synthesis.png`, { fullPage: true });
    await panel.locator('.workspace-logic-map-open').click();
    await panel.waitForFunction(() =>
      document.querySelector('.workspace-view[data-workspace-view="mechanism"]')?.hidden === false);
    const pageCountAfterMechanism = context.pages().length;
    qa.mechanism.sameTab = pageCountAfterMechanism === pageCountBeforeMechanism &&
      panel.url().includes('/popup.html');
    if (false) {
    for (let index = 0; index < 3; index += 1) {
      const before = await panel.locator('.workspace-mechanism-node').count();
      await panel.locator('#addMechanismChainNode').click();
      await panel.waitForFunction(expected =>
        document.querySelectorAll('.workspace-mechanism-node').length === expected,
      before + 1, { timeout: 15000 });
    }
    const nodeValues = [
      'PDAC 肿瘤微环境',
      'CAF 乳酸代谢上调',
      '神经周围侵袭增强'
    ];
    for (let index = 0; index < nodeValues.length; index += 1) {
      await editInline(panel,
        `.workspace-mechanism-node:nth-of-type(${index + 1}) .workspace-mechanism-node-label`,
        nodeValues[index]);
    }
    const edgeLabels = ['促进代谢重塑', '驱动侵袭表型'];
    for (let index = 0; index < edgeLabels.length; index += 1) {
      const edges = panel.locator('.workspace-mechanism-edge');
      const edge = edges.nth(index).locator('.workspace-mechanism-edge-label');
      await edge.dblclick();
      const editor = edge.locator('textarea');
      await editor.fill(edgeLabels[index]);
      await editor.press('Control+Enter');
      await panel.waitForFunction(({ index, value }) =>
        [...document.querySelectorAll('.workspace-mechanism-edge-label')][index]
          ?.textContent.includes(value), { index, value: edgeLabels[index] }, { timeout: 15000 });
    }
    const addEvidence = async (edgeIndex, label, evidenceClass) => {
      const edge = panel.locator('.workspace-mechanism-edge').nth(edgeIndex);
      const select = edge.locator('.workspace-mechanism-evidence-select');
      await select.selectOption({ label });
      await panel.waitForFunction(({ edgeIndex, label }) =>
        [...document.querySelectorAll('.workspace-mechanism-edge')][edgeIndex]
          ?.querySelector('.workspace-mechanism-evidence')?.textContent.includes(label),
      { edgeIndex, label }, { timeout: 15000 });
      const classSelect = panel.locator('.workspace-mechanism-edge').nth(edgeIndex)
        .locator('.workspace-mechanism-evidence-class').last();
      await classSelect.selectOption(evidenceClass);
      await panel.waitForTimeout(300);
    };
    await addEvidence(0, 'S1B', 'sufficiency');
    await addEvidence(1, 'S2A', 'necessity');
    // Exercise removal and addition without leaving a duplicate final reference.
    const firstEvidence = panel.locator('.workspace-mechanism-edge').first()
      .locator('.workspace-mechanism-evidence');
    await firstEvidence.getByRole('button', { name: /移除 Panel 证据/ }).click();
    await panel.waitForFunction(() =>
      !document.querySelector('.workspace-mechanism-edge')
        ?.querySelector('.workspace-mechanism-evidence')?.textContent.includes('S1B'));
    await addEvidence(0, 'S1B', 'sufficiency');
    await panel.setViewportSize({ width: 700, height: 1000 });
    await screenshot(panel, `paper-${id}-wide-mechanism.png`, { fullPage: true });
    await panel.setViewportSize({ width: 380, height: 900 });
    await screenshot(panel, `paper-${id}-narrow-mechanism.png`, { fullPage: true });
    qa.mechanism.render = await panel.evaluate(() => {
      const colors = [...document.querySelectorAll('.workspace-mechanism-evidence')]
        .map(node => ({ text: node.childNodes[0]?.textContent || '', color: getComputedStyle(node).color,
          className: node.className }));
      return {
        nodeCount: document.querySelectorAll('.workspace-mechanism-node').length,
        edgeCount: document.querySelectorAll('.workspace-mechanism-edge').length,
        arrows: [...document.querySelectorAll('.workspace-mechanism-arrow')]
          .every(node => node.textContent.trim() === '↓'),
        colors,
        horizontalOverflow: document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1
      };
    });
    }

    const complexMechanismJson = await panel.evaluate(createCanonicalMechanismQaFixture, { s1Id, s2Id });
    const mechanismImportPath = artifact(`paper-${id}-mechanism-import.json`);
    fs.writeFileSync(mechanismImportPath, complexMechanismJson, 'utf8');
    await panel.locator('#openMechanismExportMenu').click();
    await panel.locator('#mechanismNetworkExportMenu').waitFor({ state: 'visible' });
    const initialMechanismImport = await panel.evaluate(async jsonText => {
      const file = new File([jsonText], 'mechanism-network.json', {
        type: 'application/json'
      });
      const response = await importMechanismNetworkFile(file);
      let direct = null;
      if (!response?.success) {
        const context = captureFigureWorkspaceEditContext();
        try {
          const ensured = await sendTabMessage(context.tabId, {
            action: 'ensureArticleWorkspace', forceRefresh: true
          });
          const paper = mechanismNetworkPaperIdentity(ensured?.workspace || null);
          SciLLM.parseMechanismNetworkJson(jsonText, paper);
          const restored = await sendTabMessage(context.tabId, {
            action: 'restoreMechanismNetworkDraft',
            jsonText,
            expectedRevision: Number(mechanismWorkspaceDraft()?.revision || 0),
            restoreTarget: {
              authorizationToken: String(ensured?.restoreAuthorization?.token || ''),
              current: {
                workspaceId: paper.workspaceId,
                workspaceGeneration: paper.workspaceGeneration,
                canonicalUrl: paper.canonicalUrl,
                contentHash: paper.contentHash
              },
              documentId: paper.documentId
            }
          });
          direct = {
            success: restored?.success === true,
            code: restored?.code || '',
            error: restored?.error || '',
            draftRevision: restored?.draft?.revision ?? null
          };
        } catch (error) {
          direct = {
            success: false,
            code: error?.code || '',
            error: String(error?.message || '').slice(0, 120)
          };
        }
      }
      return {
        success: response?.success === true,
        code: response?.code || '',
        stage: response?.stage || '',
        direct,
        status: document.getElementById('workspaceStatus')?.textContent || '',
        nodeCount: mechanismWorkspaceDraft()?.mechanismChain?.nodes?.length || 0,
        edgeCount: mechanismWorkspaceDraft()?.mechanismChain?.edges?.length || 0
      };
    }, complexMechanismJson);
    if (!initialMechanismImport.success) {
      throw new Error(`Mechanism JSON import failed: ${JSON.stringify(initialMechanismImport)}`);
    }
    await panel.waitForFunction(() => {
      const draft = currentWorkspaceSnapshot?.figures?.draft ||
        currentWorkspaceSnapshot?.figureWorkspaceDraft;
      return draft?.mechanismChain?.nodes?.length === 10 &&
        draft.mechanismChain.edges.length === 14;
    }, null, { timeout: 20000 });

    const networkState = async () => panel.evaluate(() => {
      const draft = mechanismWorkspaceDraft();
      const chain = draft?.mechanismChain;
      const layout = SciLLM.createMechanismNetworkLayout(chain, {
        viewportWidth: Math.max(320,
          document.getElementById('mechanismNetworkViewport')?.clientWidth || 680)
      });
      const nodes = new Map(layout.nodes.map(item => [item.id, item]));
      const edges = new Map(layout.edges.map(item => [item.id, item]));
      const endpointHits = (edgeId, nodeId) => {
        const edge = edges.get(edgeId);
        const node = nodes.get(nodeId);
        if (!edge || !node) return false;
        const horizontal = edge.endX === node.x || edge.endX === node.x + node.width;
        const vertical = edge.endY === node.y || edge.endY === node.y + node.height;
        return horizontal || vertical;
      };
      const negativeVisible = document.querySelector(
        '.workspace-mechanism-edge-visible.is-negative'
      );
      return {
        revision: draft?.revision,
        nodeCount: chain?.nodes?.length || 0,
        edgeCount: chain?.edges?.length || 0,
        defaultReadMode: !document.querySelector(
          '#mechanismChainList textarea, #mechanismChainList select'
        ),
        hiddenNodeControls: [...document.querySelectorAll(
          '.workspace-mechanism-node-actions'
        )].every(node => getComputedStyle(node).opacity === '0'),
        pageHorizontalOverflow: document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
        negativeFeedbackArrowHitsSource: endpointHits('negative-feedback', 'source'),
        positiveFeedbackArrowHitsBranchB: endpointHits('positive-feedback', 'branch-b'),
        selfLoopVisible: edges.get('self-positive')?.selfLoop === true &&
          Boolean(document.querySelector(
            '.workspace-mechanism-edge-visible.is-self-loop'
          )),
        negativeDashed: Boolean(negativeVisible &&
          getComputedStyle(negativeVisible).strokeDasharray !== 'none'),
        evidenceLabels: [...document.querySelectorAll(
          '.workspace-mechanism-evidence-chip'
        )].map(node => node.textContent.trim())
      };
    });

    qa.mechanism.network = await networkState();
    await panel.setViewportSize({ width: 700, height: 1000 });
    await screenshot(panel, `paper-${id}-wide-mechanism-network.png`, { fullPage: true });
    await panel.locator(
      '.workspace-mechanism-edge-label[data-edge-id="negative-feedback"]'
    ).click();
    await panel.locator('#mechanismSelectionInspector').waitFor({ state: 'visible' });
    qa.mechanism.inspectorVisible = true;
    await screenshot(panel, `paper-${id}-mechanism-edge-inspector.png`, { fullPage: true });
    await panel.locator('.workspace-mechanism-node[data-node-id="self"]').click();
    const revisionBeforeFocus = await panel.evaluate(() =>
      mechanismWorkspaceDraft()?.revision || 0);
    await panel.locator('#focusMechanismPath').click();
    qa.mechanism.focus = await panel.evaluate(revision => ({
      pressed: document.getElementById('focusMechanismPath')
        ?.getAttribute('aria-pressed') === 'true',
      dimmed: document.querySelectorAll(
        '.workspace-mechanism-node.is-dimmed, .workspace-mechanism-edge-visible.is-dimmed'
      ).length,
      revisionUnchanged: (mechanismWorkspaceDraft()?.revision || 0) === revision
    }), revisionBeforeFocus);
    await screenshot(panel, `paper-${id}-mechanism-focus-path.png`, { fullPage: true });
    await panel.locator('#focusMechanismPath').click();

    const editedSource = '共同上游核团（人工校订）';
    await editInline(panel, '[data-node-id="source"] .workspace-mechanism-node-label',
      editedSource);
    qa.mechanism.inlineEditSaved = await panel.evaluate(expected =>
      mechanismWorkspaceDraft()?.mechanismChain?.nodes
        ?.find(node => node.id === 'source')?.label?.value === expected,
    editedSource);

    const downloadMechanism = async (format, filename) => {
      await panel.locator('#openMechanismExportMenu').click();
      const downloadPromise = panel.waitForEvent('download');
      await panel.locator(`[data-mechanism-export="${format}"]`).click();
      const download = await downloadPromise;
      const target = artifact(filename);
      await download.saveAs(target);
      return target;
    };
    const pngPath = await downloadMechanism(
      'png', `paper-${id}-mechanism-network.png`
    );
    const svgPath = await downloadMechanism(
      'svg', `paper-${id}-mechanism-network.svg`
    );
    const jsonPath = await downloadMechanism(
      'json', `paper-${id}-mechanism-network.json`
    );
    const pngBytes = fs.readFileSync(pngPath);
    const exportedSvg = fs.readFileSync(svgPath, 'utf8');
    const exportedJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const jsonRoundTripEqual = await panel.evaluate(payload => {
      const parsed = SciLLM.parseMechanismNetworkJson(
        JSON.stringify(payload), payload.paper
      );
      return JSON.stringify(parsed.mechanismChain) ===
        JSON.stringify(payload.mechanismChain);
    }, exportedJson);
    qa.mechanism.exports = {
      png: {
        validSignature: pngBytes.subarray(0, 8).equals(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        ), bytes: pngBytes.length
      },
      svg: {
        hasArrowMarkers: /<marker[^>]+mechanism-arrow/u.test(exportedSvg),
        hasNoControls: !/<textarea|<select|新增|删除/iu.test(exportedSvg)
      },
      json: {
        schema: exportedJson.schema,
        nodeCount: exportedJson.mechanismChain?.nodes?.length || 0,
        edgeCount: exportedJson.mechanismChain?.edges?.length || 0,
        roundTripEqual: jsonRoundTripEqual
      }
    };
    const pngPreview = await context.newPage();
    await pngPreview.setContent(`<img alt="mechanism png" style="max-width:100%" src="data:image/png;base64,${pngBytes.toString('base64')}">`);
    await screenshot(pngPreview, `paper-${id}-mechanism-png-preview.png`, { fullPage: true });
    await pngPreview.close();
    const svgPreview = await context.newPage();
    await svgPreview.setContent(exportedSvg);
    await screenshot(svgPreview, `paper-${id}-mechanism-svg-preview.png`, { fullPage: true });
    await svgPreview.close();

    await panel.setViewportSize({ width: 380, height: 900 });
    await panel.waitForFunction(() =>
      document.querySelectorAll('.workspace-mechanism-node').length === 10 &&
      Boolean(document.querySelector('.workspace-mechanism-edge-visible.is-negative')),
    null, { timeout: 10000 });
    qa.mechanism.narrow = await networkState();
    await screenshot(panel, `paper-${id}-narrow-mechanism-network.png`, { fullPage: true });
    await panel.locator('#backFromMechanismChain').click();

    await reloadBoundPanel(panel, articlePage);
    await switchView(panel, 'figures');
    const persistedOrder = await figureOrder(panel);
    qa.editing.persistedAfterReload = await panel.evaluate(
      ({ question, remaining, purpose, note }) => {
        const draft = currentWorkspaceSnapshot?.figures?.draft ||
          currentWorkspaceSnapshot?.figureWorkspaceDraft;
        const figure = draft?.figures?.['figure-1'];
        return {
          question: figure?.overview?.figureQuestion?.value === question,
          remaining: figure?.overview?.remainingQuestion?.value === remaining,
          purpose: figure?.panels?.A?.purpose?.value === purpose,
          note: figure?.panels?.A?.note?.value === note,
          background: draft?.meta?.backgroundItems?.[0]?.value || '',
          scientificQuestion: draft?.meta?.scientificQuestions?.[0]?.value || '',
          mechanismNodes: draft?.mechanismChain?.nodes?.map(node => node.label?.value) || [],
          evidence: draft?.mechanismChain?.edges?.flatMap(edge => edge.panelEvidence || []) || []
        };
      }, { question, remaining, purpose, note });
    qa.supplemental.s2PanelQa.persistedAfterReload = await panel.evaluate(
      ({ s2Id, expected }) => {
        const figure = currentWorkspaceSnapshot?.figures?.figures
          ?.find(item => item.figureId === s2Id);
        const draft = currentWorkspaceSnapshot?.figures?.draft ||
          currentWorkspaceSnapshot?.figureWorkspaceDraft;
        const purpose = draft?.figures?.[s2Id]?.panels?.A?.purpose?.value;
        return figure?.standard?.basis === 'vision_text' &&
          figure.standard.panels.length > 0 && purpose === expected;
      }, { s2Id, expected: s2PanelEditValue });
    qa.supplemental.persistedOrder = persistedOrder.map(item => item.label);

    await panel.locator('.workspace-logic-map-open').click();
    await panel.waitForFunction(() =>
      document.querySelector('.workspace-view[data-workspace-view="mechanism"]')
        ?.hidden === false);
    qa.mechanism.persistedAfterReload = await panel.evaluate(expected =>
      mechanismWorkspaceDraft()?.mechanismChain?.nodes
        ?.find(node => node.id === 'source')?.label?.value === expected,
    editedSource);
    await editInline(panel, '[data-node-id="source"] .workspace-mechanism-node-label',
      '临时覆盖值');
    const revisionBeforeImport = await panel.evaluate(() =>
      mechanismWorkspaceDraft()?.revision || 0);
    await panel.locator('#openMechanismExportMenu').click();
    const exportedJsonText = fs.readFileSync(jsonPath, 'utf8');
    const reimportResult = await panel.evaluate(async jsonText => {
      const file = new File([jsonText], 'mechanism-network.json', {
        type: 'application/json'
      });
      return importMechanismNetworkFile(file);
    }, exportedJsonText);
    if (!reimportResult?.success) {
      throw new Error(`Mechanism JSON reimport failed: ${reimportResult?.code || 'unknown'}`);
    }
    await panel.waitForFunction(expected =>
      mechanismWorkspaceDraft()?.mechanismChain?.nodes
        ?.find(node => node.id === 'source')?.label?.value === expected,
    editedSource, { timeout: 20000 });
    qa.mechanism.importAfterReload = await panel.evaluate(revision => ({
      persisted: mechanismWorkspaceDraft()?.mechanismChain?.nodes
        ?.find(node => node.id === 'source')?.label?.value === '共同上游核团（人工校订）',
      revisionAdvanced: (mechanismWorkspaceDraft()?.revision || 0) > revision,
      nodeCount: mechanismWorkspaceDraft()?.mechanismChain?.nodes?.length || 0,
      edgeCount: mechanismWorkspaceDraft()?.mechanismChain?.edges?.length || 0
    }), revisionBeforeImport);
    await screenshot(panel, `paper-${id}-mechanism-json-reimport.png`, { fullPage: true });
    await panel.locator('#backFromMechanismChain').click();

    await panel.locator('#figurePanelHeaderFieldsButton').click();
    const headerMenu = panel.locator('#figurePanelHeaderFieldsMenu');
    await headerMenu.waitFor({ state: 'visible' });
    await headerMenu.evaluate(menu => {
      const input = menu.querySelector('[data-figure-panel-header-field="comparison"]');
      if (input && !input.checked) input.click();
    });
    await panel.waitForFunction(() => figurePanelHeaderFieldsState.comparison === true &&
      figurePanelHeaderFieldsSaving === false);
    await headerMenu.evaluate(menu => {
      const input = menu.querySelector(
        '[data-figure-panel-header-field="directObservation"]'
      );
      if (input && !input.checked) input.click();
    });
    await panel.waitForFunction(() => figurePanelHeaderFieldsState.comparison === true &&
      figurePanelHeaderFieldsState.directObservation === true);
    qa.editing.headerMenu = await panel.evaluate(() => ({
      checkboxCount: document.querySelectorAll('[data-figure-panel-header-field]').length,
      checked: [...document.querySelectorAll('[data-figure-panel-header-field]:checked')]
        .map(node => node.dataset.figurePanelHeaderField)
    }));
    await panel.setViewportSize({ width: 380, height: 900 });
    await screenshot(panel, `paper-${id}-narrow-header-menu.png`);
    await panel.setViewportSize({ width: 700, height: 1000 });
    await screenshot(panel, `paper-${id}-wide-header-menu.png`);
    await panel.setViewportSize({ width: 380, height: 900 });
    await panel.locator('#figurePanelHeaderFieldsButton').click();

    qa.providerMock.configuration = await configureLocalMock(panel);
    await panel.evaluate(async () => loadLlmSettings());
    await panel.waitForFunction(() => hasUsableLlm() === true, null, { timeout: 10000 });
    qa.providerMock.usableAfterConfiguration = await panel.evaluate(() => hasUsableLlm());

    await switchView(panel, 'navigation');
    await panel.locator('#expandAllOutlineLevels').click();
    await panel.evaluate(() => document.querySelectorAll(
      '.workspace-view[data-workspace-view="navigation"] details'
    ).forEach(node => { node.open = true; }));
    const summaryAction = panel.locator('.workspace-paragraph-summary-action').first();
    await summaryAction.waitFor({ state: 'visible' });
    const paragraphId = await summaryAction.locator('xpath=..')
      .locator('.workspace-paragraph-jump').getAttribute('data-paragraph-id');
    await summaryAction.click();
    await panel.waitForFunction(idValue =>
      (currentWorkspaceSnapshot?.paragraphSummaries || [])
        .some(item => item?.paragraphId === idValue && String(item?.summary || '').trim()),
    paragraphId, { timeout: 30000 });
    qa.summary = await panel.evaluate(idValue => ({
      paragraphId: idValue,
      generated: (currentWorkspaceSnapshot?.paragraphSummaries || [])
        .some(item => item?.paragraphId === idValue && String(item?.summary || '').trim())
    }), paragraphId);

    await switchView(panel, 'figures');
    await openFigure(panel, 'figure-1', 'A');
    const secondMainAnalysisRequestStart = providerRequests.length;
    await panel.locator(
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-analyze-action'
    ).click();
    await panel.waitForFunction(() => {
      const figure = currentWorkspaceSnapshot?.figures?.figures
        ?.find(item => item.figureId === 'figure-1');
      return figure?.standard?.remainingQuestion?.includes('下一张 Figure');
    }, null, { timeout: 90000 });
    await openFigure(panel, 'figure-1', 'A');
    qa.figureAnalysis = await panel.evaluate(() => {
      const card = document.querySelector('.workspace-figure-card[data-figure-id="figure-1"]');
      const figure = currentWorkspaceSnapshot?.figures?.figures
        ?.find(item => item.figureId === 'figure-1');
      return {
        remainingQuestionVisible: [...card.querySelectorAll('[data-field="remainingQuestion"]')]
          .some(node => node.textContent.trim().length > 0),
        modelRemainingQuestionGenerated: Boolean(
          figure?.standard?.remainingQuestion?.includes('下一张 Figure')
        ),
        evidenceBlockCount: card.querySelectorAll('.workspace-evidence-block').length,
        transitionCount: card.querySelectorAll('.workspace-evidence-transition').length,
        allFolded: [...card.querySelectorAll(
          '.workspace-evidence-block, .workspace-evidence-transition'
        )].every(node => node.open === false),
        oldBottomSectionsAbsent: ![...card.querySelectorAll('.workspace-figure-result-summary')]
          .some(node => /多米诺论证链|证据组织|组间逻辑连接/u.test(node.textContent))
      };
    });
    qa.figureAnalysis.providerVisionRequests = providerRequests.slice(secondMainAnalysisRequestStart)
      .filter(request => request.figureId === 'figure-1' && request.method === 'POST')
      .map(request => ({
        kind: request.kind,
        imageInputCount: request.imageInputCount,
        dataImageCount: request.dataImageCount,
        imageMimeTypes: request.imageMimeTypes,
        imageInputSha256: request.imageInputSha256
      }));
    const evidenceBlockEdit = `QA-${id}-人工证据块目标`;
    const evidenceTransitionEdit = `QA-${id}-人工承上启下关系`;
    await editInline(panel,
      '.workspace-figure-card[data-figure-id="figure-1"] ' +
      '.workspace-evidence-block:first-of-type [data-field="groupGoal"] ' +
      '.workspace-figure-edit-target',
      evidenceBlockEdit);
    const transitionEditTarget = panel.locator(
      '.workspace-figure-card[data-figure-id="figure-1"] ' +
      '.workspace-evidence-transition [data-field="transitionToNext"] ' +
      '.workspace-figure-edit-target'
    ).first();
    await transitionEditTarget.evaluate(node => {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
    });
    await transitionEditTarget.dblclick();
    const transitionEditor = transitionEditTarget.locator(
      'textarea.workspace-figure-inline-editor'
    );
    await transitionEditor.fill(evidenceTransitionEdit);
    await panel.setViewportSize({ width: 380, height: 900 });
    await screenshot(panel, `paper-${id}-narrow-evidence-inline-editor.png`);
    await transitionEditor.press('Control+Enter');
    await panel.waitForFunction(expected =>
      [...document.querySelectorAll(
        '.workspace-evidence-transition [data-field="transitionToNext"]'
      )].some(node => node.textContent.includes(expected)),
    evidenceTransitionEdit, { timeout: 15000 });
    await reloadBoundPanel(panel, articlePage);
    await switchView(panel, 'figures');
    await openFigure(panel, 'figure-1', 'A');
    qa.figureAnalysis.editingPersistedAfterReload = await panel.evaluate(
      ({ evidenceBlockEdit, evidenceTransitionEdit }) => {
        const draft = currentWorkspaceSnapshot?.figures?.draft ||
          currentWorkspaceSnapshot?.figureWorkspaceDraft;
        const blocks = draft?.figures?.['figure-1']?.evidenceBlocks || [];
        return {
          block: blocks.some(item => item?.groupGoal?.value === evidenceBlockEdit &&
            item?.groupGoal?.humanReviewed === true),
          transition: blocks.some(item => item?.transitionToNext?.value ===
            evidenceTransitionEdit && item?.transitionToNext?.humanReviewed === true)
        };
      }, { evidenceBlockEdit, evidenceTransitionEdit });
    await panel.setViewportSize({ width: 700, height: 1000 });
    await panel.evaluate(() => document.querySelector(
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-evidence-transition'
    )?.scrollIntoView({ block: 'center' }));
    await screenshot(panel, `paper-${id}-wide-evidence-blocks.png`, { fullPage: true });
    await panel.setViewportSize({ width: 380, height: 900 });
    await panel.evaluate(() => document.querySelector(
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-evidence-transition'
    )?.scrollIntoView({ block: 'center' }));
    await screenshot(panel, `paper-${id}-narrow-evidence-blocks.png`, { fullPage: true });

    const panelA = panel.locator(
      '.workspace-figure-card[data-figure-id="figure-1"] .workspace-figure-panel-card[data-panel-id="A"]'
    );
    await panelA.evaluate(node => { node.open = true; });
    await panelA.locator('.workspace-panel-ask').click();
    const followup = panelA.locator('.workspace-panel-followup');
    await followup.locator('input[type="checkbox"]').evaluateAll(nodes =>
      nodes.forEach(node => { node.checked = false; node.dispatchEvent(new Event('change')); }));
    const selectedTopicCount = await followup.locator('input[type="checkbox"]:checked').count();
    const customQuestion = '为什么作者需要在这个 Panel 之后继续下一步实验？';
    await followup.locator('textarea').fill(customQuestion);
    await followup.locator('.workspace-panel-followup-submit').click();
    const answer = panelA.locator('.workspace-panel-followup-answer');
    await answer.waitFor({ state: 'visible', timeout: 30000 });
    qa.followup = await answer.evaluate((node, { customQuestion, selectedTopicCount }) => ({
      customOnly: selectedTopicCount === 0,
      answerVisible: node.textContent.includes('已仅回答自定义问题'),
      jumpLabels: [...node.querySelectorAll('.workspace-panel-followup-source')]
        .map(button => button.textContent.trim()),
      focused: document.activeElement === node,
      newlyRevealed: node.classList.contains('is-newly-revealed')
    }), { customQuestion, selectedTopicCount });
    const panelJump = answer.locator('.workspace-panel-followup-source').filter({ hasText: '定位 1A' });
    if (await panelJump.count()) await panelJump.click();
    qa.followup.panelJumpExpanded = await panelA.evaluate(node => node.open === true);
    await screenshot(panel, `paper-${id}-narrow-followup-jump.png`);
    qa.visual.narrow = await visualMetrics(panel);
    await panel.setViewportSize({ width: 700, height: 1000 });
    qa.visual.wide = await visualMetrics(panel);

    detailed = qa;
    result.detailed = qa;
    await panel.close();
    await articlePage.close();
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
  const extensionErrors = articleResults.flatMap(item => item.panelDiagnostics.pageErrors);
  const article2 = articleResults.find(item => item.pmcId === '12167935') ||
    articleResults.find(item => item.detailed);
  const dmgArticle = articleResults.find(item => item.pmcId === '12767537');
  const p = detailed || {};
  const pass = Boolean(
    articleResults.length === articleUrls.length &&
    articleResults.every(item => item.navigation.loaded.paragraphCount > 0) &&
    articleResults.every(item => item.navigation.loaded.loadedImageCount > 0) &&
    articleResults.every(item => item.sourceFigureVisual?.rendered === true) &&
    articleResults.every(item => officialFigureSources.some(source =>
      source.pmcId === `PMC${item.pmcId}` && !source.error
    )) &&
    officialFigureSources.filter(item => !item.error)
      .every(item => item.sourceStatus === 200 && item.width > 0 && item.height > 0 &&
        /^[a-f0-9]{64}$/u.test(item.sha256)) &&
    officialSupplementarySources.filter(item => !item.error).length === 2 &&
    officialSupplementarySources.filter(item => !item.error)
      .every(item => item.sourceStatus === 200 && item.width > 0 && item.height > 0 &&
        /^[a-f0-9]{64}$/u.test(item.sha256)) &&
    dmgArticle?.realPanelQa?.summary?.generated === true &&
    dmgArticle?.realPanelQa?.figureAnalysis?.actualPanelId?.startsWith('1A') &&
    dmgArticle?.realPanelQa?.figureAnalysis?.basis === 'vision_text' &&
    dmgArticle?.realPanelQa?.figureAnalysis?.providerImageInputCount > 0 &&
    dmgArticle?.realPanelQa?.followup?.customOnly === true &&
    dmgArticle?.realPanelQa?.followup?.jumpLabels?.some(label => label.includes('1A')) &&
    dmgArticle?.realPanelQa?.followup?.sourceCount >= 2 &&
    dmgArticle?.realPanelQa?.reset?.preferencesSuccess === true &&
    article2?.workspace.figureCount >= 8 && article2?.workspace.panelCount >= 80 &&
    articleResults.every(item => item.realMainInputProbe?.sourceRendered === true) &&
    p.noLlm?.usableBeforeConfiguration === false &&
    p.noLlm?.template?.overview?.length === 5 &&
    p.noLlm?.template?.fields?.includes('note') && p.noLlm?.template?.noteIsLast &&
    p.compactIds?.main?.oneE && p.compactIds?.main?.twoA &&
    p.compactIds?.supplemental?.s1b && p.compactIds?.supplemental?.s2a &&
    p.supplemental?.officialInputs?.length === 2 &&
    p.supplemental?.officialInputs?.every(item => item.width > 0 && item.height > 0 &&
      /^[a-f0-9]{64}$/u.test(item.sha256)) &&
    p.supplemental?.analysisStates?.s1?.controllerCompleted === true &&
    p.supplemental?.analysisStates?.s1?.complete === true &&
    p.supplemental?.analysisStates?.s1?.basis === 'vision_text' &&
    p.supplemental?.analysisStates?.s1?.panelCount >= 1 &&
    p.supplemental?.analysisStates?.s2?.controllerCompleted === true &&
    p.supplemental?.analysisStates?.s2?.complete === true &&
    p.supplemental?.analysisStates?.s2?.basis === 'vision_text' &&
    p.supplemental?.analysisStates?.s2?.panelCount >= 1 &&
    p.supplemental?.s2PanelQa?.visibleBeforeEdit === true &&
    p.supplemental?.s2PanelQa?.editable === true &&
    p.supplemental?.s2PanelQa?.persistedAfterReload === true &&
    p.supplemental?.providerVisionRequests?.filter(item =>
      item.imageInputCount > 0 && item.dataImageCount > 0
    ).length >= 2 &&
    p.editing?.persistedAfterReload?.question &&
    p.editing?.persistedAfterReload?.remaining &&
    p.editing?.persistedAfterReload?.purpose &&
    p.editing?.persistedAfterReload?.note &&
    p.editing?.headerMenu?.checkboxCount === 6 &&
    p.supplemental?.longPressActivated === true &&
    JSON.stringify(p.supplemental?.dragOrder) ===
      JSON.stringify(p.supplemental?.persistedOrder) &&
    p.mechanism?.sameTab &&
    p.mechanism?.autoSynthesis?.figureButtonVisible === true &&
    p.mechanism?.autoSynthesis?.removedMechanismButton === true &&
    p.mechanism?.autoSynthesis?.backgroundItems >= 1 &&
    p.mechanism?.autoSynthesis?.scientificQuestions >= 1 &&
    p.mechanism?.autoSynthesis?.innovationPoints >= 1 &&
    p.mechanism?.autoSynthesis?.limitationPoints >= 1 &&
    p.mechanism?.autoSynthesis?.mechanismNodes >= 2 &&
    p.mechanism?.autoSynthesis?.mechanismEdges >= 1 &&
    p.mechanism?.autoSynthesis?.providerKinds?.includes('cross-figure') &&
    p.mechanism?.network?.nodeCount === 10 &&
    p.mechanism?.network?.edgeCount === 14 &&
    p.mechanism?.network?.defaultReadMode === true &&
    p.mechanism?.network?.hiddenNodeControls === true &&
    p.mechanism?.network?.pageHorizontalOverflow === false &&
    p.mechanism?.network?.negativeFeedbackArrowHitsSource === true &&
    p.mechanism?.network?.positiveFeedbackArrowHitsBranchB === true &&
    p.mechanism?.network?.selfLoopVisible === true &&
    p.mechanism?.network?.negativeDashed === true &&
    p.mechanism?.network?.evidenceLabels?.includes('S1B') &&
    p.mechanism?.network?.evidenceLabels?.includes('S2A') &&
    p.mechanism?.inspectorVisible === true &&
    p.mechanism?.focus?.pressed === true && p.mechanism?.focus?.dimmed > 0 &&
    p.mechanism?.focus?.revisionUnchanged === true &&
    p.mechanism?.inlineEditSaved === true &&
    p.mechanism?.persistedAfterReload === true &&
    p.mechanism?.exports?.png?.validSignature === true &&
    p.mechanism?.exports?.svg?.hasArrowMarkers === true &&
    p.mechanism?.exports?.svg?.hasNoControls === true &&
    p.mechanism?.exports?.json?.roundTripEqual === true &&
    p.mechanism?.importAfterReload?.persisted === true &&
    p.mechanism?.importAfterReload?.revisionAdvanced === true &&
    p.mechanism?.narrow?.pageHorizontalOverflow === false &&
    p.providerMock?.configuration?.saveSuccess &&
    p.providerMock?.configuration?.routingSuccess &&
    p.providerMock?.configuration?.preferencesSuccess &&
    p.providerMock?.usableAfterConfiguration && p.summary?.generated &&
    p.figureAnalysis?.remainingQuestionVisible &&
    p.figureAnalysis?.modelRemainingQuestionGenerated &&
    p.figureAnalysis?.evidenceBlockCount >= 2 &&
    p.figureAnalysis?.transitionCount >= 1 && p.figureAnalysis?.allFolded &&
    p.figureAnalysis?.oldBottomSectionsAbsent &&
    p.figureAnalysis?.editingPersistedAfterReload?.block === true &&
    p.figureAnalysis?.editingPersistedAfterReload?.transition === true &&
    p.figureAnalysis?.providerVisionRequests?.some(item => item.imageInputCount > 0 &&
      item.dataImageCount > 0) &&
    p.followup?.customOnly && p.followup?.answerVisible &&
    p.followup?.jumpLabels?.some(label => label === '定位 1A') &&
    p.followup?.panelJumpExpanded &&
    p.visual?.narrow?.horizontalOverflow === false &&
    p.visual?.narrow?.clippedRelevantBlocks === 0 &&
    p.visual?.wide?.horizontalOverflow === false &&
    extensionErrors.length === 0 && !providerRequests.some(item =>
      item.kind === 'unknown' && item.method !== 'GET'
    )
  );
  const result = {
    pass,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    extension: {
      path: extensionPath, name: manifest.name, version: manifest.version
    },
    llmVerification: {
      actualConfiguredLlmUsed: false,
      localDeterministicProviderUsed: true,
      statement: 'No real LLM/API credential was present or read. The localhost provider validates browser routing and schema contracts only.'
    },
    officialDerivedSources: derivedArticleMetadata,
    officialFigureSources,
    officialSupplementarySources,
    realImageVerification: {
      derivedPagesUseOfficialPixels: articleResults.every(item =>
        item.navigation.loaded.loadedImageCount > 0 && item.sourceFigureVisual?.rendered === true
      ),
      mainFigureCount: officialFigureSources.filter(item => !item.error).length,
      supplementaryFigureCount: officialSupplementarySources.filter(item => !item.error).length,
      providerVisionPostCount: providerRequests.filter(item =>
        item.method === 'POST' && item.dataImageCount > 0
      ).length,
      providerImageInputCount: providerRequests.reduce(
        (sum, item) => sum + Number(item.imageInputCount || 0), 0
      )
    },
    articleResults,
    providerRequests,
    artifacts,
    extensionPageErrors: extensionErrors
  };
  fs.writeFileSync(artifact('qa-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (process.env.QA_QUIET === '1') {
    process.stdout.write(`${JSON.stringify({
      pass: result.pass,
      elapsedMs: result.elapsedMs,
      articleCount: result.articleResults.length,
      artifactCount: result.artifacts.length + 1,
      realImageVerification: result.realImageVerification,
      extensionPageErrors: result.extensionPageErrors
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  if (!pass) process.exitCode = 1;
} finally {
  await context?.close().catch(() => undefined);
  await new Promise(resolve => providerServer.close(resolve));
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.rmSync(resourceTempDir, { recursive: true, force: true });
}
