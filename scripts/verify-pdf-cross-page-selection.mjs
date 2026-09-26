import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  dragSelectAcrossNativePdfPages,
  readPreparedNativePdfSelectionEvidence,
  waitForNativePdfManualReady,
  waitForNativePdfReaderReady
} from './pdf-selection-evidence-helper.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

if (process.argv.includes('--help')) {
  console.log(`Usage: node scripts/verify-pdf-cross-page-selection.mjs [options]

Options:
  --pdf <path>       Public/local PDF to open (default: public eLife acceptance PDF)
  --extension <dir>  Unpacked extension source (default: repository root)
  --output <dir>     Unique artifact directory (default: output/playwright timestamped run)
  --headed           Show the isolated Edge window (default: headless)
  --same-page-only   Run a clean ordinary-sentence highlight lifecycle
  --device-scale-factor <n>  Browser DPR for canvas/overlay acceptance (default: 1)

This verifier blocks every HTTP(S) request. It uses real Playwright mouse down,
wheel, move, and up input to select from PDF page 1 into page 2. It then requires
  the real manual toolbar, one associated annotation group with PDF QuadPoints for both pages,
stable normalized overlay geometry after a real zoom-button click, and the same
annotation identity/anchors after a full reload. It never calls an LLM/API.`);
  process.exit(0);
}

const defaultPdf = path.join(repositoryRoot, 'tmp', 'public-pdf-acceptance',
  'elife-83176-v2.pdf');
const pdfPath = path.resolve(argument('--pdf', defaultPdf));
const extensionRoot = path.resolve(argument('--extension', repositoryRoot));
const runStamp = new Date().toISOString().replace(/[:.]/gu, '-');
const outputDirectory = path.resolve(argument('--output', path.join(
  repositoryRoot, 'output', 'playwright', `pdf-cross-page-selection-${runStamp}`
)));
const headed = process.argv.includes('--headed');
const samePageOnly = process.argv.includes('--same-page-only');
const requestedDpr = Number(argument('--device-scale-factor', '1'));
const deviceScaleFactor = Number.isFinite(requestedDpr) && requestedDpr >= 1 && requestedDpr <= 3
  ? requestedDpr : 1;
const expectedPublicSha256 = pdfPath === path.resolve(defaultPdf)
  ? '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1' : '';
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-cross-page-'));
const temporaryExtension = path.join(temporaryRoot, 'extension');
const profileDirectory = path.join(temporaryRoot, 'profile');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function canonicalSelectionText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function containsKnownElifeFurniture(value) {
  return /(?:Nebeling et al\.|Research article|Neuroscience|\b2\s+of\s+23\b|doi\.org\/10\.7554\/eLife\.83176)/iu
    .test(String(value || ''));
}

function knownElifeFurnitureKinds(value) {
  const text = String(value || '');
  return [
    ['author-running-footer', /Nebeling et al\./iu],
    ['article-running-header', /Research article/iu],
    ['section-running-header', /Neuroscience/iu],
    ['page-counter', /\b(?:1|2)\s+of\s+23\b/iu],
    ['doi-running-footer', /doi\.org\/10\.7554\/eLife\.83176/iu]
  ].filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

function safeError(error) {
  const raw = String(error?.message || error?.code || error || 'UNKNOWN_ERROR');
  const code = raw.match(/[A-Z][A-Z0-9_:-]{4,}/u)?.[0] || error?.name || 'Error';
  return { name: String(error?.name || 'Error').slice(0, 80), code: code.slice(0, 160),
    detailSha256: sha256(raw), detailBytes: Buffer.byteLength(raw) };
}

function safeRemoveTemporary(target) {
  const root = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (resolved.startsWith(root + path.sep) &&
      path.basename(resolved).startsWith('brevess-pdf-cross-page-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function copyExtension() {
  fs.mkdirSync(temporaryExtension, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(extensionRoot, directory), path.join(temporaryExtension, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(extensionRoot)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(extensionRoot, file), path.join(temporaryExtension, file));
    }
  }
}

function extensionBuildHash(directory) {
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) files.push(filename);
    }
  };
  visit(directory);
  const hash = crypto.createHash('sha256');
  for (const filename of files) {
    hash.update(path.relative(directory, filename).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(filename));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function writeReport(report) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, 'report.json');
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

async function capture(page, report, name) {
  const target = path.join(outputDirectory, name);
  await page.screenshot({ path: target, fullPage: false });
  const artifact = { name, bytes: fs.statSync(target).size, sha256: sha256File(target) };
  report.artifacts.push(artifact);
  writeReport(report);
  return artifact;
}

async function waitForReader(page, expectedHash) {
  await waitForNativePdfReaderReady(page, expectedHash);
}

async function waitForPageRendered(page, pageNumber) {
  await page.waitForFunction(number => {
    const pageNode = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${number}"]`);
    return pageNode?.classList.contains('is-rendered') &&
      pageNode.querySelectorAll('.pdf-native-text-layer span').length > 0 &&
      pageNode.querySelector('canvas')?.width > 0;
  }, pageNumber, { timeout: 30_000 });
}

async function navigatePage(page, pageNumber) {
  const input = page.locator('#pdfReaderPageNumber');
  await input.fill(String(pageNumber));
  await input.press('Enter');
  await input.evaluate(node => node.dispatchEvent(new Event('change', { bubbles: true })));
  await waitForPageRendered(page, pageNumber);
}

async function waitForManualReady(page, expectedHash) {
  await waitForNativePdfManualReady(page, expectedHash);
}

async function setSelectionScale(page) {
  // Keep the production fit-width scale. The same public PDF has a proven
  // selectable text layer at this reading scale; crossing pages is performed
  // with a real wheel gesture while the primary mouse button stays pressed.
  const scale = await page.evaluate(() => Number(
    globalThis.__brevessPdfReaderBridge?.command?.('getState')?.scale || 0
  ));
  assert.ok(scale > 0, 'CROSS_PAGE_SELECTION_SCALE_MISSING');
  return scale;
}

async function chooseBoundarySpan(page, pageNumber, side) {
  const spans = page.locator(
    `.pdf-native-page[data-pdf-page-number="${pageNumber}"] .pdf-native-text-layer span`
  );
  const index = await spans.evaluateAll((nodes, input) => {
    const pageNode = nodes[0]?.closest('.pdf-native-page');
    const pageRect = pageNode?.getBoundingClientRect();
    if (!pageRect?.height) return -1;
    const candidates = nodes.map((node, index) => {
      const rect = node.getBoundingClientRect();
      const text = String(node.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
      const alpha = (text.match(/[A-Za-z\p{L}]/gu) || []).length;
      return { index, text, alpha, rect, ratio: (rect.top - pageRect.top) / pageRect.height };
    }).filter(item => item.text.length >= 60 && item.alpha >= 30 && item.rect.width >= 250 &&
      item.rect.height >= 6 && !/(?:https?:\/\/|doi\b|@|copyright|eLife|^[\d\W]+$)/iu.test(item.text));
    const preferred = candidates.filter(item => input.side === 'end'
      ? item.ratio >= 0.55 && item.ratio <= 0.88
      : item.ratio >= 0.12 && item.ratio <= 0.48);
    const pool = preferred.length ? preferred : candidates;
    pool.sort((left, right) => input.side === 'end'
      ? right.rect.top - left.rect.top || right.rect.left - left.rect.left
      : left.rect.top - right.rect.top || left.rect.left - right.rect.left);
    return pool[0]?.index ?? -1;
  }, { side });
  assert.ok(index >= 0, `CROSS_PAGE_${side.toUpperCase()}_SPAN_MISSING`);
  return spans.nth(index);
}

async function chooseOrdinaryBodySpan(page, pageNumber) {
  const spans = page.locator(
    `.pdf-native-page[data-pdf-page-number="${pageNumber}"] .pdf-native-text-layer span`
  );
  const result = await spans.evaluateAll(nodes => {
    const pageNode = nodes[0]?.closest('.pdf-native-page');
    const pageRect = pageNode?.getBoundingClientRect();
    if (!pageRect?.height) return { index: -1, nodeCount: nodes.length, pageHeight: 0 };
    const measured = nodes.map((node, index) => {
      const rect = node.getBoundingClientRect();
      const text = String(node.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
      return {
        index, textLength: text.length, rect,
        alpha: (text.match(/[A-Za-z\p{L}]/gu) || []).length,
        ratio: (rect.top - pageRect.top) / pageRect.height
      };
    });
    const candidates = measured.filter(item => item.textLength >= 25 && item.alpha >= 18 && item.rect.width >= 120 &&
      item.rect.height >= 6 && item.ratio >= 0.2 && item.ratio <= 0.82 &&
      !/(?:https?:\/\/|doi\b|@|copyright|eLife|^[\d\W]+$)/iu.test(
        String(nodes[item.index]?.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
      ));
    candidates.sort((left, right) =>
      Math.abs(left.ratio - 0.55) - Math.abs(right.ratio - 0.55) ||
      right.textLength - left.textLength);
    const widths = measured.map(item => item.rect.width);
    const textLengths = measured.map(item => item.textLength);
    const bodyNodes = measured.filter(item => item.ratio >= 0.2 && item.ratio <= 0.82);
    return {
      index: candidates[0]?.index ?? -1,
      nodeCount: measured.length,
      bodyNodeCount: bodyNodes.length,
      candidateCount: candidates.length,
      maxWidth: Math.round(Math.max(0, ...widths)),
      maxTextLength: Math.max(0, ...textLengths),
      maxBodyWidth: Math.round(Math.max(0, ...bodyNodes.map(item => item.rect.width))),
      maxBodyTextLength: Math.max(0, ...bodyNodes.map(item => item.textLength))
    };
  });
  if (result.index < 0) {
    const error = new Error('SAME_PAGE_BODY_SPAN_MISSING');
    error.evidence = result;
    throw error;
  }
  return spans.nth(result.index);
}

async function inspectBrowserSelection(page) {
  const raw = await page.evaluate(() => {
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const layerFor = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)
      ?.closest?.('.pdf-native-text-layer');
    const startLayer = range ? layerFor(range.startContainer) : null;
    const endLayer = range ? layerFor(range.endContainer) : null;
    const pageRects = [];
    if (range) {
      for (const number of [1, 2]) {
        const pageNode = document.querySelector(
          `.pdf-native-page[data-pdf-page-number="${number}"]`);
        const pageRect = pageNode?.getBoundingClientRect();
        const matches = Array.from(range.getClientRects()).filter(rect => pageRect &&
          rect.right > pageRect.left && rect.left < pageRect.right &&
          rect.bottom > pageRect.top && rect.top < pageRect.bottom);
        if (matches.length) pageRects.push({ pageNumber: number, rectCount: matches.length });
      }
    }
    return {
      text: String(selection || '').normalize('NFKC').replace(/\s+/gu, ' ').trim(),
      rangeCount: selection?.rangeCount || 0,
      collapsed: selection?.isCollapsed ?? true,
      startPage: Number(startLayer?.dataset?.pdfPageNumber) || 0,
      endPage: Number(endLayer?.dataset?.pdfPageNumber) || 0,
      pageRects,
      toolbarVisible: (() => {
        const toolbar = document.querySelector('#sci-manual-toolbar');
        if (!toolbar) return false;
        const style = getComputedStyle(toolbar);
        const rect = toolbar.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
      })(),
      statusVisible: Boolean(document.querySelector('#sci-manual-status')?.offsetParent),
      statusType: String(document.querySelector('#sci-manual-status')?.className || ''),
      statusText: String(document.querySelector('#sci-manual-status')?.textContent || '')
    };
  });
  const summary = {
    characterCount: raw.text.length,
    textSha256: sha256(raw.text),
    rangeCount: raw.rangeCount,
    collapsed: raw.collapsed,
    startPage: raw.startPage,
    endPage: raw.endPage,
    pageRects: raw.pageRects,
    toolbarVisible: raw.toolbarVisible,
    statusVisible: raw.statusVisible,
    statusType: raw.statusType,
    statusTextSha256: raw.statusText ? sha256(raw.statusText) : '',
    statusTextBytes: Buffer.byteLength(raw.statusText)
  };
  return { rawText: raw.text, summary };
}

async function performRealCrossPageSelection(page) {
  await navigatePage(page, 2);
  await navigatePage(page, 1);
  const scale = await setSelectionScale(page);
  await waitForPageRendered(page, 1);
  const start = await chooseBoundarySpan(page, 1, 'end');
  await start.scrollIntoViewIfNeeded();
  await waitForPageRendered(page, 2);
  const end = await chooseBoundarySpan(page, 2, 'start');
  const startBox = await start.boundingBox();
  assert.ok(startBox?.width > 10 && startBox?.height > 4,
    'CROSS_PAGE_START_SPAN_NOT_VISIBLE');
  const viewport = page.viewportSize();
  assert.ok(viewport, 'CROSS_PAGE_VIEWPORT_MISSING');
  const viewerBox = await page.locator('#pdfNativeViewer').boundingBox();
  assert.ok(viewerBox, 'CROSS_PAGE_VIEWER_BOX_MISSING');
  const startPoint = {
    x: Math.min(viewport.width - 8, startBox.x + 2),
    y: Math.min(viewport.height - 8, startBox.y + startBox.height / 2)
  };
  const targetEvidence = await page.evaluate(({ startPoint: first, endPoint: second }) => {
    const summarize = point => {
      const element = document.elementFromPoint(point.x, point.y);
      return {
        tag: String(element?.tagName || ''),
        className: String(element?.className || '').slice(0, 120),
        pageNumber: Number(element?.closest?.('[data-pdf-page-number]')?.dataset?.pdfPageNumber) || 0
      };
    };
    return { start: summarize(first), end: summarize(second) };
  }, { startPoint, endPoint: {
    x: Math.min(viewport.width - 8, (await end.boundingBox())?.x + 8 || 0),
    y: Math.min(viewport.height - 8, ((await end.boundingBox())?.y || 0) + 4)
  } });

  // Prove the selected start span is reachable by genuine mouse input before
  // attempting the harder cross-page gesture. This preflight is cleared by a
  // genuine click in the page margin and is never counted as the acceptance action.
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(Math.min(viewport.width - 8, startBox.x + startBox.width - 3),
    startPoint.y, { steps: 16 });
  const samePageDuringDrag = await inspectBrowserSelection(page);
  await page.mouse.up();
  const samePageAfterUp = await inspectBrowserSelection(page);
  if (!(samePageDuringDrag.summary.characterCount > 0 &&
      samePageDuringDrag.summary.startPage === 1 &&
      samePageDuringDrag.summary.endPage === 1)) {
    const error = new Error('CROSS_PAGE_START_SPAN_MOUSE_PREFLIGHT_FAILED');
    error.evidence = { scale, startBox, startPoint, targetEvidence,
      samePageDuringDrag: samePageDuringDrag.summary,
      samePageAfterUp: samePageAfterUp.summary };
    throw error;
  }
  const pageBox = await page.locator(
    '.pdf-native-page[data-pdf-page-number="1"]').boundingBox();
  assert.ok(pageBox, 'CROSS_PAGE_START_PAGE_BOX_MISSING');
  await page.mouse.click(pageBox.x + Math.max(6, pageBox.width - 8),
    Math.max(pageBox.y + 8, Math.min(pageBox.y + pageBox.height - 8, startPoint.y)));

  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  let wheelSteps = 0;
  let endBox = null;
  let finalEndEvidence = null;
  let duringDrag = null;
  try {
    // Establish a non-collapsed range inside page 1 before crossing the page gap.
    await page.mouse.move(Math.min(viewport.width - 8,
      startBox.x + Math.max(10, startBox.width * 0.7)), startPoint.y, { steps: 10 });
    for (; wheelSteps < 16; wheelSteps += 1) {
      endBox = await end.boundingBox();
      if (endBox && endBox.y >= viewerBox.y + 8 &&
          endBox.y + endBox.height <= viewerBox.y + viewerBox.height - 12) {
        const point = {
          x: Math.min(viewport.width - 8, endBox.x + Math.max(4, endBox.width - 3)),
          y: endBox.y + endBox.height / 2
        };
        finalEndEvidence = await page.evaluate(position => {
          const element = document.elementFromPoint(position.x, position.y);
          return {
            isTextSpan: element?.matches?.('.pdf-native-text-layer span') === true,
            pageNumber: Number(element?.closest?.('[data-pdf-page-number]')
              ?.dataset?.pdfPageNumber) || 0
          };
        }, point);
        if (finalEndEvidence.isTextSpan && finalEndEvidence.pageNumber === 2) break;
      }
      await page.mouse.move(Math.min(viewport.width - 40, startPoint.x + 80),
        viewerBox.y + viewerBox.height - 35, { steps: 4 });
      await page.mouse.wheel(0, 220);
      await page.waitForTimeout(90);
    }
    endBox = await end.boundingBox();
    assert.ok(endBox && finalEndEvidence?.isTextSpan && finalEndEvidence.pageNumber === 2,
      'CROSS_PAGE_END_SPAN_NOT_REACHED_BY_WHEEL');
    await page.mouse.move(
      Math.min(viewport.width - 8, endBox.x + Math.max(4, endBox.width - 3)),
      endBox.y + endBox.height / 2,
      { steps: 24 }
    );
    duringDrag = await inspectBrowserSelection(page);
  } finally {
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  const selection = await inspectBrowserSelection(page);
  return { scale, wheelSteps, targetEvidence,
    finalEndEvidence,
    samePagePreflight: samePageDuringDrag.summary,
    samePageAfterUp: samePageAfterUp.summary,
    duringDrag: duringDrag?.summary || null, ...selection };
}

function roundedPoints(points) {
  return Array.from(points || [], value => Math.round(Number(value) * 1000) / 1000);
}

function annotationAnchors(annotation) {
  const inputs = [
    annotation?.pdfAnchor,
    ...(Array.isArray(annotation?.pdfAnchors) ? annotation.pdfAnchors : []),
    ...(Array.isArray(annotation?.anchors) ? annotation.anchors : [])
  ].filter(item => item?.anchorKind === 'pdf_quad' || item?.quadPoints);
  const seen = new Set();
  return inputs.map(anchor => ({
    pageNumber: Number(anchor?.pageNumber) || 0,
    documentHash: String(anchor?.documentHash || ''),
    quadPoints: roundedPoints(anchor?.quadPoints)
  })).filter(anchor => {
    const key = `${anchor.pageNumber}:${JSON.stringify(anchor.quadPoints)}`;
    if (!anchor.pageNumber || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.pageNumber - right.pageNumber);
}

async function readCreatedAnnotationGroup(page, baselineIds) {
  const results = await page.evaluate(prior =>
    (currentManualDocument?.record?.annotations || []).filter(item =>
      !prior.includes(String(item?.annotationId || ''))
    ).map(item => structuredClone(item)), baselineIds);
  assert.ok(results.length > 0, 'CROSS_PAGE_ANNOTATION_NOT_CREATED');
  const annotations = results.map(item => ({
    annotationId: String(item.annotationId || ''),
    groupId: String(item.selectionGroupId || item.annotationGroupId || item.groupId || ''),
    groupIndex: Number(item.selectionGroupIndex) || 0,
    quote: String(item.quote || ''),
    quoteSha256: sha256(String(item.quote || '')),
    anchors: annotationAnchors(item)
  })).sort((left, right) => left.groupIndex - right.groupIndex);
  assert.ok(annotations.every(item => item.annotationId),
    'CROSS_PAGE_ANNOTATION_ID_MISSING');
  const anchors = annotations.flatMap(item => item.anchors)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  if (annotations.length > 1) {
    const groupIds = [...new Set(annotations.map(item => item.groupId).filter(Boolean))];
    assert.equal(groupIds.length, 1, 'CROSS_PAGE_ANNOTATIONS_NOT_ASSOCIATED');
    assert.ok(annotations.every(item => item.groupId === groupIds[0]),
      'CROSS_PAGE_ANNOTATION_GROUP_MISMATCH');
  }
  return {
    annotations,
    annotationIds: annotations.map(item => item.annotationId),
    annotationIdHashes: annotations.map(item => sha256(item.annotationId)).sort(),
    groupIdSha256: annotations[0]?.groupId ? sha256(annotations[0].groupId) : '',
    anchors,
    anchorSha256: sha256(JSON.stringify(anchors))
  };
}

async function collectOverlayGeometry(page, annotationIds, pageNumber) {
  await navigatePage(page, pageNumber);
  await page.waitForFunction(({ number, ids }) =>
    [...document.querySelectorAll(
      `.pdf-native-page[data-pdf-page-number="${number}"] .pdf-native-annotation-hit`
    )].some(node => ids.includes(String(node.dataset.annotationId || ''))),
  { number: pageNumber, ids: annotationIds }, { timeout: 15_000 });
  const hits = page.locator(
    `.pdf-native-page[data-pdf-page-number="${pageNumber}"] .pdf-native-annotation-hit`
  );
  return hits.evaluateAll((nodes, ids) => nodes.filter(node =>
    ids.includes(String(node.dataset.annotationId || ''))).map(node => {
    const pageNode = node.closest('.pdf-native-page');
    const pageRect = pageNode.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    return {
      annotationId: String(node.dataset.annotationId || ''),
      left: Number(((rect.left - pageRect.left) / pageRect.width).toFixed(6)),
      top: Number(((rect.top - pageRect.top) / pageRect.height).toFixed(6)),
      width: Number((rect.width / pageRect.width).toFixed(6)),
      height: Number((rect.height / pageRect.height).toFixed(6)),
      quadIndex: Number(node.dataset.pdfQuadIndex)
    };
  }).sort((left, right) => left.annotationId.localeCompare(right.annotationId) ||
    left.quadIndex - right.quadIndex), annotationIds);
}

async function countKnownFurnitureOverlayHits(page, annotationIds, pageNumber) {
  await navigatePage(page, pageNumber);
  return page.evaluate(({ ids, number }) => {
    const pageNode = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${number}"]`
    );
    if (!pageNode) return -1;
    const furniture = [...pageNode.querySelectorAll('.pdf-native-text-layer span')]
      .filter(node => /(?:Nebeling et al\.|Research article|Neuroscience|\b2\s+of\s+23\b|doi\.org\/10\.7554\/eLife\.83176)/iu
        .test(String(node.textContent || '')))
      .map(node => node.getBoundingClientRect());
    const overlays = [...pageNode.querySelectorAll('.pdf-native-annotation-hit')]
      .filter(node => ids.includes(String(node.dataset.annotationId || '')))
      .map(node => node.getBoundingClientRect());
    return overlays.filter(overlay => furniture.some(rect =>
      overlay.right > rect.left && overlay.left < rect.right &&
      overlay.bottom > rect.top && overlay.top < rect.bottom)).length;
  }, { ids: annotationIds, number: pageNumber });
}

async function recycleNativePages(page, pageNumbers, pageCount) {
  const target = Math.min(pageCount, Math.max(...pageNumbers) + 3);
  assert.ok(!pageNumbers.includes(target), 'CROSS_PAGE_RECYCLE_TARGET_INVALID');
  await navigatePage(page, target);
  await page.waitForFunction(numbers => numbers.every(number => {
    const node = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${number}"]`);
    return !node?.classList.contains('is-rendered') &&
      !node?.querySelector('.pdf-native-text-layer span') && !node?.querySelector('canvas');
  }), pageNumbers, { timeout: 20_000 });
  return { recycleTargetPage: target, unmountedPages: [...pageNumbers] };
}

function assertGeometryStable(before, after, label) {
  assert.equal(after.length, before.length, `${label}_COUNT_CHANGED`);
  for (let index = 0; index < before.length; index += 1) {
    assert.equal(after[index].quadIndex, before[index].quadIndex, `${label}_INDEX_CHANGED`);
    assert.equal(after[index].annotationId, before[index].annotationId,
      `${label}_ANNOTATION_CHANGED`);
    for (const key of ['left', 'top', 'width', 'height']) {
      assert.ok(Math.abs(after[index][key] - before[index][key]) <= 0.002,
        `${label}_${key.toUpperCase()}_DRIFTED`);
    }
  }
}

async function verifySamePageVisibleHighlight(page, report, sourceHash, options = {}) {
  await navigatePage(page, 2);
  await waitForPageRendered(page, 2);
  const target = await chooseOrdinaryBodySpan(page, 2);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  assert.ok(box?.width > 100 && box?.height > 4, 'SAME_PAGE_TARGET_NOT_VISIBLE');
  const baselineIds = await page.evaluate(() =>
    (currentManualDocument?.record?.annotations || []).map(item => String(item.annotationId || ''))
  );
  if (options.requireClean === true) {
    assert.deepEqual(baselineIds, [], 'SAME_PAGE_PROFILE_NOT_CLEAN');
    assert.equal(await page.locator('.pdf-native-annotation-hit').count(), 0,
      'SAME_PAGE_ORIGINAL_ALREADY_HIGHLIGHTED');
  }
  await capture(page, report, '04-same-page-original.png');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const selected = await inspectBrowserSelection(page);
  assert.equal(selected.summary.startPage, 2, 'SAME_PAGE_SELECTION_START_WRONG');
  assert.equal(selected.summary.endPage, 2, 'SAME_PAGE_SELECTION_END_WRONG');
  assert.ok(selected.summary.characterCount >= 20, 'SAME_PAGE_SELECTION_TOO_SHORT');
  assert.equal(selected.summary.toolbarVisible, true, 'SAME_PAGE_TOOLBAR_MISSING');
  const visual = await target.evaluate(node => {
    const pageNode = node.closest('.pdf-native-page');
    const canvas = pageNode?.querySelector('canvas');
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const pageRect = pageNode?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const spanRect = node.getBoundingClientRect();
    if (!range || !pageRect?.width || !canvasRect?.width || !canvas?.width) return null;
    const rects = Array.from(range.getClientRects()).filter(rect =>
      rect.right > spanRect.left && rect.left < spanRect.right &&
      rect.bottom > spanRect.top && rect.top < spanRect.bottom);
    const union = rects.length ? {
      left: Math.min(...rects.map(rect => rect.left)),
      top: Math.min(...rects.map(rect => rect.top)),
      right: Math.max(...rects.map(rect => rect.right)),
      bottom: Math.max(...rects.map(rect => rect.bottom))
    } : null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;
    const x0 = Math.max(0, Math.floor((spanRect.left - canvasRect.left) * scaleX));
    const x1 = Math.min(canvas.width, Math.ceil((spanRect.right - canvasRect.left) * scaleX));
    const y0 = Math.max(0, Math.floor((spanRect.top - canvasRect.top - 4) * scaleY));
    const y1 = Math.min(canvas.height, Math.ceil((spanRect.bottom - canvasRect.top + 4) * scaleY));
    const pixels = context?.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    let inkTop = Infinity, inkBottom = -Infinity, inkPixels = 0;
    if (pixels) {
      for (let y = 0; y < pixels.height; y += 1) {
        for (let x = 0; x < pixels.width; x += 1) {
          const offset = (y * pixels.width + x) * 4;
          if (pixels.data[offset] + pixels.data[offset + 1] + pixels.data[offset + 2] < 500) {
            inkPixels += 1;
            inkTop = Math.min(inkTop, y0 + y);
            inkBottom = Math.max(inkBottom, y0 + y + 1);
          }
        }
      }
    }
    const normalize = rect => rect ? {
      left: (rect.left - pageRect.left) / pageRect.width,
      top: (rect.top - pageRect.top) / pageRect.height,
      right: (rect.right - pageRect.left) / pageRect.width,
      bottom: (rect.bottom - pageRect.top) / pageRect.height
    } : null;
    return {
      span: normalize(spanRect),
      range: normalize(union),
      ink: inkPixels > 0 ? {
        top: (canvasRect.top + inkTop / scaleY - pageRect.top) / pageRect.height,
        bottom: (canvasRect.top + inkBottom / scaleY - pageRect.top) / pageRect.height,
        pixels: inkPixels
      } : null
    };
  });
  assert.ok(visual?.range && visual?.ink?.pixels > 20, 'SAME_PAGE_VISIBLE_INK_MISSING');
  await capture(page, report, '05-same-page-native-selection.png');
  const categories = page.locator('#sci-manual-toolbar .sci-manual-category:visible');
  assert.ok(await categories.count() > 0, 'SAME_PAGE_CATEGORY_MISSING');
  await categories.first().click();
  await page.waitForFunction(prior =>
    (currentManualDocument?.record?.annotations || []).some(item =>
      !prior.includes(String(item?.annotationId || ''))), baselineIds, { timeout: 15_000 });
  const created = await readCreatedAnnotationGroup(page, baselineIds);
  assert.equal(canonicalSelectionText(created.annotations.map(item => item.quote).join(' ')),
    canonicalSelectionText(selected.rawText), 'SAME_PAGE_PERSISTED_QUOTE_DIFFERS_FROM_SELECTION');
  assert.equal(created.annotations.some(item => containsKnownElifeFurniture(item.quote)), false,
    'SAME_PAGE_PERSISTED_QUOTE_CONTAINS_PAGE_FURNITURE');
  assert.ok(created.anchors.every(anchor => anchor.pageNumber === 2 &&
    anchor.documentHash.replace(/^sha256:/u, '') === sourceHash),
  'SAME_PAGE_ANCHOR_IDENTITY_MISMATCH');
  const overlays = await collectOverlayGeometry(page, created.annotationIds, 2);
  assert.ok(overlays.length > 0, 'SAME_PAGE_OVERLAY_MISSING');
  if (options.requireClean === true) {
    assert.equal(overlays.length, 1, 'SAME_PAGE_ADJACENT_TEXT_OVERLAY_PRESENT');
  }
  assert.equal(await countKnownFurnitureOverlayHits(page, created.annotationIds, 2), 0,
    'SAME_PAGE_FURNITURE_OVERLAY_PRESENT');
  const overlay = {
    left: Math.min(...overlays.map(item => item.left)),
    top: Math.min(...overlays.map(item => item.top)),
    right: Math.max(...overlays.map(item => item.left + item.width)),
    bottom: Math.max(...overlays.map(item => item.top + item.height))
  };
  for (const edge of ['top', 'bottom']) {
    assert.ok(Math.abs(overlay[edge] - visual.range[edge]) <= 0.003,
      `SAME_PAGE_OVERLAY_${edge.toUpperCase()}_DRIFTED`);
  }
  assert.ok(overlay.top <= visual.ink.top + 0.003,
    'SAME_PAGE_OVERLAY_STARTS_BELOW_VISIBLE_GLYPHS');
  assert.ok(overlay.bottom >= visual.ink.bottom - 0.003,
    'SAME_PAGE_OVERLAY_ENDS_ABOVE_VISIBLE_GLYPHS');
  report.metrics.samePageVisibleHighlight = {
    selectedCharacters: selected.summary.characterCount,
    selectedTextSha256: selected.summary.textSha256,
    pageNumber: 2,
    visibleInkPixels: visual.ink.pixels,
    span: visual.span,
    range: visual.range,
    overlay,
    overlayCount: overlays.length,
    anchorSha256: created.anchorSha256
  };
  // Clicking the fixed toolbar can restore the reader's prior scroll position.
  // Bring the measured sentence back into view so the artifact itself shows the
  // same glyphs whose canvas pixels and overlay bounds were asserted above.
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await capture(page, report, '06-same-page-plugin-highlight.png');

  if (options.verifyPersistence === true) {
    const geometryBefore = overlays;
    const widthBeforeZoom = await page.locator(
      '.pdf-native-page[data-pdf-page-number="2"] canvas'
    ).evaluate(node => node.getBoundingClientRect().width);
    await page.locator('#pdfReaderZoomIn').click();
    await page.waitForFunction(width => {
      const canvas = document.querySelector(
        '.pdf-native-page[data-pdf-page-number="2"] canvas');
      return canvas && Math.abs(canvas.getBoundingClientRect().width - width) > 1;
    }, widthBeforeZoom, { timeout: 20_000 });
    const geometryZoomed = await collectOverlayGeometry(page, created.annotationIds, 2);
    assertGeometryStable(geometryBefore, geometryZoomed, 'SAME_PAGE_ZOOM');

    await navigatePage(page, report.metrics.reader.pageCount);
    await waitForPageRendered(page, report.metrics.reader.pageCount);
    await page.waitForFunction(() => !document.querySelector(
      '.pdf-native-page[data-pdf-page-number="2"] .pdf-native-text-layer'
    ), null, { timeout: 15_000 });
    const pageTwoUnmounted = true;
    await navigatePage(page, 2);
    await waitForPageRendered(page, 2);
    const geometryRemounted = await collectOverlayGeometry(page, created.annotationIds, 2);
    assertGeometryStable(geometryZoomed, geometryRemounted, 'SAME_PAGE_REMOUNT');

    const exported = await page.evaluate(async () => {
      const bridge = globalThis.__brevessPdfReaderBridge;
      const context = await bridge.command('exportAnnotatedPdf');
      const bytes = context.bytes;
      const verification = await bridge.command('verifyAnnotatedPdf', bytes, context);
      return {
        byteLength: Number(bytes?.byteLength) || 0,
        annotationsDigest: String(context.annotationsDigest || ''),
        annotationCount: context.annotationsSnapshot?.length || 0,
        verified: verification?.ok === true,
        verifiedCount: verification?.verifiedIds?.length || 0,
        missingCount: verification?.missingIds?.length || 0
      };
    });
    assert.ok(exported.byteLength > 1000, 'SAME_PAGE_EXPORTED_PDF_EMPTY');
    assert.equal(exported.verified, true, 'SAME_PAGE_EXPORTED_PDF_ANNOTATIONS_INVALID');
    assert.equal(exported.missingCount, 0, 'SAME_PAGE_EXPORTED_PDF_ANNOTATIONS_MISSING');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForReader(page, sourceHash);
    await waitForManualReady(page, sourceHash);
    const restored = await page.evaluate(ids =>
      (currentManualDocument?.record?.annotations || []).filter(item =>
        ids.includes(String(item?.annotationId || ''))
      ).map(item => structuredClone(item)), created.annotationIds);
    assert.equal(restored.length, created.annotationIds.length,
      'SAME_PAGE_ANNOTATION_NOT_RESTORED');
    const restoredAnchors = restored.flatMap(annotationAnchors)
      .sort((left, right) => left.pageNumber - right.pageNumber);
    assert.equal(sha256(JSON.stringify(restoredAnchors)), created.anchorSha256,
      'SAME_PAGE_RELOADED_ANCHORS_CHANGED');
    const geometryReloaded = await collectOverlayGeometry(page, created.annotationIds, 2);
    assertGeometryStable(geometryRemounted, geometryReloaded, 'SAME_PAGE_RELOAD');
    report.metrics.samePagePersistence = {
      zoomGeometrySha256: sha256(JSON.stringify(geometryZoomed)),
      pageTwoUnmounted,
      remountGeometrySha256: sha256(JSON.stringify(geometryRemounted)),
      reloadGeometrySha256: sha256(JSON.stringify(geometryReloaded)),
      anchorsExact: true,
      exported
    };
    await page.locator(
      '.pdf-native-page[data-pdf-page-number="2"] .pdf-native-annotation-hit'
    ).evaluateAll((nodes, ids) => {
      nodes.find(node => ids.includes(String(node.dataset.annotationId || '')))
        ?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, created.annotationIds);
    await page.waitForTimeout(100);
    await capture(page, report, '07-same-page-plugin-highlight-reloaded.png');
  }
}

const report = {
  status: 'RUNNING',
  runKind: samePageOnly
    ? 'real-pdf-same-page-highlight-lifecycle-zero-api'
    : 'real-pdf-cross-page-selection-zero-api',
  acceptance: {
    input: samePageOnly
      ? 'real Playwright native Range selection of an ordinary eLife body sentence'
      : 'real Playwright mouse down + scroll-if-needed + move + up across PDF pages 1 and 2',
    required: samePageOnly
      ? ['clean initial state', 'browser selection equals persisted quote',
        'one exact visible body overlay', 'real zoom and page unmount/remount preserve geometry',
        'exported PDF reopens with the annotation',
        'same annotation and anchor restore after full reload', 'zero HTTP(S) requests']
      : ['browser body selection covers pages 1 and 2 without page furniture',
        'real manual toolbar visible',
        'one action stores an associated annotation group covering page 1 and page 2 QuadPoints',
        'normalized overlays stable after real zoom click and virtualized unmount/remount',
        'exported PDF reopens with every segmented annotation',
        'same annotation and anchors restored after full reload', 'zero HTTP(S) requests']
  },
  isolation: { temporaryExtension: true, temporaryProfile: true, dailyBrowserUsed: false,
    sourcePdfReadOnly: true, externalNetworkBlocked: true, llmApiCalls: 0,
    deviceScaleFactor },
  source: {},
  checkpoints: [],
  metrics: {},
  network: { httpRequests: 0, apiRequests: 0, blockedOrigins: [] },
  diagnostics: { pageErrors: [], consoleErrors: [], workerErrors: [] },
  artifacts: [],
  error: null
};

const checkpoint = (name, detail = {}) => {
  report.checkpoints.push({ name, elapsedMs: Date.now() - startedAt, ...detail });
  writeReport(report);
};

fs.mkdirSync(outputDirectory, { recursive: true });
writeReport(report);
const startedAt = Date.now();
let context;
let page;

try {
  assert.ok(fs.existsSync(pdfPath) && fs.statSync(pdfPath).isFile(),
    'CROSS_PAGE_PDF_INPUT_MISSING');
  assert.match(fs.readFileSync(pdfPath).subarray(0, 5).toString('latin1'), /^%PDF-/u,
    'CROSS_PAGE_PDF_INPUT_INVALID');
  assert.ok(fs.existsSync(path.join(extensionRoot, 'manifest.json')),
    'CROSS_PAGE_EXTENSION_MANIFEST_MISSING');
  const sourceHash = sha256File(pdfPath);
  if (expectedPublicSha256) assert.equal(sourceHash, expectedPublicSha256,
    'CROSS_PAGE_PUBLIC_PDF_HASH_MISMATCH');
  report.source = {
    pdfSha256: sourceHash,
    pdfBytes: fs.statSync(pdfPath).size,
    expectedPageCount: expectedPublicSha256 ? 23 : 0,
    provenance: expectedPublicSha256 ? 'tmp/public-pdf-acceptance/source.json' : 'explicit --pdf'
  };
  copyExtension();
  report.source.extensionBuildSha256 = extensionBuildHash(temporaryExtension);
  checkpoint('source-validated');

  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'msedge', headless: !headed, reducedMotion: 'reduce',
    viewport: { width: 1280, height: 1000 }, deviceScaleFactor,
    args: [`--disable-extensions-except=${temporaryExtension}`,
      `--load-extension=${temporaryExtension}`]
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  context.on('request', request => {
    const url = request.url();
    if (!/^https?:\/\//u.test(url)) return;
    report.network.httpRequests += 1;
    if (/(?:api\.|chat\/completions|responses|openai|anthropic|deepseek|generativelanguage)/iu
      .test(url)) report.network.apiRequests += 1;
    try {
      const origin = new URL(url).origin;
      if (!report.network.blockedOrigins.includes(origin)) report.network.blockedOrigins.push(origin);
    } catch { /* keep only the count */ }
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => {
    if (message.type() === 'error') report.diagnostics.workerErrors.push({
      sha256: sha256(message.text()), bytes: Buffer.byteLength(message.text())
    });
  });
  const extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  page.on('pageerror', error => report.diagnostics.pageErrors.push(safeError(error)));
  page.on('console', message => {
    if (message.type() === 'error') report.diagnostics.consoleErrors.push({
      sha256: sha256(message.text()), bytes: Buffer.byteLength(message.text())
    });
  });
  await page.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
    waitUntil: 'domcontentloaded'
  });
  await page.locator('#pdfLocalFile').setInputFiles(pdfPath);
  await waitForReader(page, sourceHash);
  await waitForManualReady(page, sourceHash);
  report.metrics.reader = await page.evaluate(() => ({
    documentHash: String(globalThis.__brevessNativePdfDocument?.structure?.documentHash || ''),
    pageCount: Number(globalThis.__brevessNativePdfDocument?.pageCount) || 0,
    phase: String(globalThis.__brevessNativePdfDocument?.phase || ''),
    workspaceReady: document.documentElement.dataset.pdfWorkspaceReady === 'true',
    workspaceIndexed: document.documentElement.dataset.pdfWorkspaceIndexed === 'true'
  }));
  assert.equal(report.metrics.reader.documentHash, sourceHash);
  assert.ok(report.metrics.reader.pageCount >= 2, 'CROSS_PAGE_PDF_TOO_SHORT');
  if (report.source.expectedPageCount) {
    assert.equal(report.metrics.reader.pageCount, report.source.expectedPageCount,
      'CROSS_PAGE_PUBLIC_PDF_PAGE_COUNT_MISMATCH');
  }
  checkpoint('reader-ready', { pageCount: report.metrics.reader.pageCount });

  if (samePageOnly) {
    await verifySamePageVisibleHighlight(page, report, sourceHash, {
      requireClean: true,
      verifyPersistence: true
    });
    checkpoint('same-page-visible-highlight-verified');
  } else {
  const baselineIds = await page.evaluate(() =>
    (currentManualDocument?.record?.annotations || []).map(item => String(item.annotationId || ''))
  );
  const gesture = await dragSelectAcrossNativePdfPages(page, {
    startPage: 1, endPage: 2, minimumCharacters: 20
  });
  const inspected = await inspectBrowserSelection(page);
  const summarizeGestureState = state => ({
    characterCount: String(state?.text || '').length,
    textSha256: sha256(String(state?.text || '')),
    rangeCount: Number(state?.rangeCount) || 0,
    collapsed: state?.collapsed !== false,
    startPage: Number(state?.startPage) || 0,
    endPage: Number(state?.endPage) || 0,
    pageRects: Array.isArray(state?.pageRects) ? state.pageRects : [],
    toolbarVisible: false,
    statusVisible: false,
    statusType: '', statusTextSha256: '', statusTextBytes: 0
  });
  const selection = {
    scale: await page.evaluate(() => Number(
      globalThis.__brevessPdfReaderBridge?.command?.('getState')?.scale || 0
    )),
    wheelSteps: gesture.wheelSteps,
    mountedPagesAfterGesture: gesture.mountedPagesAfterGesture,
    targetEvidence: null,
    finalEndEvidence: { isTextSpan: true, pageNumber: 2 },
    samePagePreflight: null,
    samePageAfterUp: null,
    duringDrag: summarizeGestureState(gesture.duringDrag),
    ...inspected
  };
  report.metrics.selection = selection.summary;
  report.metrics.selection.inputMethod = gesture.inputMethod;
  report.metrics.selection.wheelSteps = selection.wheelSteps;
  report.metrics.selection.scale = selection.scale;
  report.metrics.selection.targetEvidence = selection.targetEvidence;
  report.metrics.selection.finalEndEvidence = selection.finalEndEvidence;
  report.metrics.selection.samePagePreflight = selection.samePagePreflight;
  report.metrics.selection.samePageAfterUp = selection.samePageAfterUp;
  report.metrics.selection.duringDrag = selection.duringDrag;
  report.metrics.selection.descriptor = await page.evaluate(() => {
    try {
      const descriptor = describeCurrentManualSelection();
      return {
        present: Boolean(descriptor),
        valid: descriptor?.validation?.valid === true,
        validationCode: String(descriptor?.validation?.code || ''),
        segmentCount: Array.isArray(descriptor?.anchorSegments)
          ? descriptor.anchorSegments.length : 0,
        segments: (descriptor?.anchorSegments || []).map(segment => ({
          pageNumber: Number(segment?.anchor?.pdfAnchor?.pageNumber) || 0,
          quoteCharacters: String(segment?.anchor?.quote || '').length,
          quadPointCount: Array.isArray(segment?.anchor?.pdfAnchor?.quadPoints)
            ? segment.anchor.pdfAnchor.quadPoints.length : 0
        })),
        retainedSelectionPresent: Boolean(currentManualSelection),
        pointerSelecting: manualPointerSelecting === true,
        lifecycle: manualUiLifecycle.snapshot()
      };
    } catch (error) {
      return { present: false, exceptionName: String(error?.name || 'Error'),
        exceptionCode: String(error?.code || '') };
    }
  });
  checkpoint('mouse-selection-complete', {
    startPage: selection.summary.startPage, endPage: selection.summary.endPage,
    selectedCharacters: selection.summary.characterCount,
    toolbarVisible: selection.summary.toolbarVisible
  });
  await capture(page, report, '01-cross-page-selection.png');
  const browserGesture = selection.duringDrag;
  assert.equal(browserGesture?.rangeCount, 1, 'CROSS_PAGE_BROWSER_RANGE_MISSING');
  assert.equal(browserGesture?.collapsed, false, 'CROSS_PAGE_BROWSER_SELECTION_COLLAPSED');
  assert.ok(browserGesture?.characterCount >= 20, 'CROSS_PAGE_BROWSER_SELECTION_TOO_SHORT');
  assert.equal(browserGesture?.startPage, 1, 'CROSS_PAGE_BROWSER_START_PAGE_WRONG');
  assert.equal(browserGesture?.endPage, 2, 'CROSS_PAGE_BROWSER_END_PAGE_WRONG');
  assert.deepEqual(browserGesture?.pageRects.map(item => item.pageNumber), [1, 2],
    'CROSS_PAGE_BROWSER_RECTS_DO_NOT_COVER_TWO_PAGES');
  assert.equal(selection.summary.toolbarVisible, true,
    'CROSS_PAGE_MANUAL_TOOLBAR_NOT_VISIBLE');
  report.metrics.selection.knownFurnitureKinds = knownElifeFurnitureKinds(selection.rawText);
  report.metrics.selection.knownFurnitureCount =
    report.metrics.selection.knownFurnitureKinds.length;
  assert.equal(report.metrics.selection.knownFurnitureCount, 0,
    'CROSS_PAGE_BROWSER_SELECTION_CONTAINS_PAGE_FURNITURE');

  const preparedSelectionEvidence = await readPreparedNativePdfSelectionEvidence(page);
  const evidenceSegments = Array.isArray(preparedSelectionEvidence?.segments)
    ? preparedSelectionEvidence.segments : [preparedSelectionEvidence];
  report.metrics.selectionEvidence = {
    segmentCount: evidenceSegments.length,
    pageNumbers: evidenceSegments.map(item => Number(item.pageNumber) || 0),
    aggregateTextCharacters: String(preparedSelectionEvidence?.text || '').length,
    aggregateTextSha256: sha256(String(preparedSelectionEvidence?.text || '')),
    segments: evidenceSegments.map(item => ({
      pageNumber: Number(item.pageNumber) || 0,
      quoteCharacters: String(item.text || '').length,
      quoteSha256: sha256(String(item.text || '')),
      contextHashSha256: sha256(String(item.contextHash || '')),
      paragraphTextHashSha256: sha256(String(item.paragraphTextHash || '')),
      documentHashMatches: String(item.documentHash || '').replace(/^sha256:/u, '') === sourceHash,
      documentGeneration: Number(item.documentGeneration) || 0,
      selectionGeneration: Number(item.selectionGeneration) || 0
    }))
  };
  assert.equal(evidenceSegments.length, report.metrics.selection.descriptor.segmentCount,
    'CROSS_PAGE_SELECTION_EVIDENCE_SEGMENTS_DROPPED');
  assert.deepEqual([...new Set(evidenceSegments.map(item => item.pageNumber))], [1, 2],
    'CROSS_PAGE_SELECTION_EVIDENCE_PAGES_DROPPED');
  assert.ok(evidenceSegments.every(item => item.paragraphTextHash &&
    String(item.documentHash || '').replace(/^sha256:/u, '') === sourceHash),
  'CROSS_PAGE_SELECTION_EVIDENCE_IDENTITY_MISSING');
  const evidenceText = canonicalSelectionText(evidenceSegments.map(item => item.text).join(' '));
  const browserBodyText = canonicalSelectionText(selection.rawText);
  const compactEvidenceText = evidenceText.replace(/\s+/gu, '');
  const compactBrowserBodyText = browserBodyText.replace(/\s+/gu, '');
  assert.equal(containsKnownElifeFurniture(evidenceText), false,
    'CROSS_PAGE_SELECTION_EVIDENCE_CONTAINS_PAGE_FURNITURE');
  assert.equal(compactEvidenceText, compactBrowserBodyText,
    'CROSS_PAGE_BROWSER_BODY_AND_EVIDENCE_TEXT_DIFFER');
  report.metrics.selectionEvidence.browserBodyMatches = true;
  report.metrics.selectionEvidence.browserBodyExactWhitespaceMatch =
    evidenceText === browserBodyText;
  report.metrics.selectionEvidence.whitespaceReconstructionCharacters =
    evidenceText.length - browserBodyText.length;
  report.metrics.selectionEvidence.compactBodySha256 = sha256(compactBrowserBodyText);
  report.metrics.selectionEvidence.knownFurnitureMatches = 0;
  checkpoint('selection-evidence-prepared', {
    segmentCount: evidenceSegments.length, pageCount: 2
  });

  // Evidence preparation may hydrate/remount a virtualized page and invalidate
  // the DOM Selection. Repeat the same genuine mouse gesture and prove it still
  // selects the same body text before clicking the annotation category.
  const annotationGesture = await dragSelectAcrossNativePdfPages(page, {
    startPage: 1, endPage: 2, minimumCharacters: 20
  });
  const annotationSelection = await inspectBrowserSelection(page);
  const annotationBodyText = canonicalSelectionText(annotationSelection.rawText);
  const compactAnnotationBodyText = annotationBodyText.replace(/\s+/gu, '');
  report.metrics.annotationSelection = {
    characterCount: annotationBodyText.length,
    textSha256: sha256(annotationBodyText),
    compactTextSha256: sha256(compactAnnotationBodyText),
    pageNumbers: annotationGesture.selection.pageRects.map(item => item.pageNumber)
  };
  assert.equal(containsKnownElifeFurniture(annotationSelection.rawText), false,
    'CROSS_PAGE_ANNOTATION_SELECTION_CONTAINS_PAGE_FURNITURE');
  assert.equal(compactAnnotationBodyText, compactEvidenceText,
    'CROSS_PAGE_ANNOTATION_SELECTION_CHANGED');
  assert.deepEqual(annotationGesture.selection.pageRects.map(item => item.pageNumber), [1, 2],
    'CROSS_PAGE_ANNOTATION_SELECTION_PAGES_CHANGED');
  await page.waitForFunction(() => {
    const toolbar = document.querySelector('#sci-manual-toolbar');
    if (!toolbar) return false;
    const rect = toolbar.getBoundingClientRect();
    const style = getComputedStyle(toolbar);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden';
  }, null, { timeout: 5000 });

  const categories = page.locator('#sci-manual-toolbar .sci-manual-category:visible');
  assert.ok(await categories.count() > 0, 'CROSS_PAGE_MANUAL_CATEGORY_MISSING');
  await categories.first().click();
  await page.waitForFunction(prior =>
    (() => {
      const created = (currentManualDocument?.record?.annotations || []).filter(item =>
        !prior.includes(String(item?.annotationId || ''))
      );
      if (!created.length) return false;
      const expected = Math.max(...created.map(item =>
        Number(item?.selectionGroupSize) || 1));
      return created.length === expected && created.every(item =>
        (Number(item?.selectionGroupSize) || 1) === expected);
    })(), baselineIds, { timeout: 15_000 });
  const created = await readCreatedAnnotationGroup(page, baselineIds);
  const persistedText = canonicalSelectionText(
    created.annotations.map(item => item.quote).join(' ')
  );
  assert.equal(persistedText, evidenceText,
    'CROSS_PAGE_PERSISTED_QUOTES_DIFFER_FROM_SELECTION_EVIDENCE');
  assert.equal(created.annotations.some(item => containsKnownElifeFurniture(item.quote)), false,
    'CROSS_PAGE_PERSISTED_QUOTE_CONTAINS_PAGE_FURNITURE');
  report.metrics.annotation = {
    annotationCount: created.annotations.length,
    annotationIdHashes: created.annotationIdHashes,
    groupIdSha256: created.groupIdSha256,
    quoteHashes: created.annotations.map(item => item.quoteSha256).sort(),
    anchorSha256: created.anchorSha256,
    anchors: created.anchors.map(anchor => ({ pageNumber: anchor.pageNumber,
      documentHashMatches: anchor.documentHash.replace(/^sha256:/u, '') === sourceHash,
      quadPointCount: anchor.quadPoints.length,
      quadPointsSha256: sha256(JSON.stringify(anchor.quadPoints)) }))
  };
  assert.deepEqual([...new Set(created.anchors.map(anchor => anchor.pageNumber))], [1, 2],
    'CROSS_PAGE_ANNOTATION_ANCHOR_PAGES_MISMATCH');
  for (const anchor of created.anchors) {
    assert.equal(anchor.documentHash.replace(/^sha256:/u, ''), sourceHash,
      `CROSS_PAGE_ANNOTATION_PAGE_${anchor.pageNumber}_HASH_MISMATCH`);
    assert.ok(anchor.quadPoints.length >= 8 && anchor.quadPoints.length % 8 === 0,
      `CROSS_PAGE_ANNOTATION_PAGE_${anchor.pageNumber}_QUADS_MISSING`);
  }
  checkpoint('annotation-created', { anchorPages: [1, 2] });

  const geometryBefore = {};
  for (const pageNumber of [1, 2]) {
    geometryBefore[pageNumber] = await collectOverlayGeometry(
      page, created.annotationIds, pageNumber);
    assert.ok(geometryBefore[pageNumber].length > 0,
      `CROSS_PAGE_PAGE_${pageNumber}_OVERLAY_MISSING`);
    const furnitureHits = await countKnownFurnitureOverlayHits(
      page, created.annotationIds, pageNumber
    );
    assert.equal(furnitureHits, 0,
      `CROSS_PAGE_PAGE_${pageNumber}_FURNITURE_OVERLAY_PRESENT`);
    report.metrics.annotation[`page${pageNumber}FurnitureOverlayHits`] = furnitureHits;
  }
  await navigatePage(page, 1);
  const widthBeforeZoom = await page.locator(
    '.pdf-native-page[data-pdf-page-number="1"] canvas').evaluate(
    node => node.getBoundingClientRect().width);
  await page.locator('#pdfReaderZoomIn').click();
  await page.waitForFunction(width => {
    const canvas = document.querySelector(
      '.pdf-native-page[data-pdf-page-number="1"] canvas');
    return canvas && Math.abs(canvas.getBoundingClientRect().width - width) > 1;
  }, widthBeforeZoom, { timeout: 20_000 });
  const geometryZoomed = {};
  for (const pageNumber of [1, 2]) {
    geometryZoomed[pageNumber] = await collectOverlayGeometry(
      page, created.annotationIds, pageNumber);
    assertGeometryStable(geometryBefore[pageNumber], geometryZoomed[pageNumber],
      `CROSS_PAGE_ZOOM_PAGE_${pageNumber}`);
  }
  report.metrics.zoom = {
    clicked: true,
    pages: [1, 2].map(pageNumber => ({ pageNumber,
      overlayCount: geometryZoomed[pageNumber].length,
      geometrySha256: sha256(JSON.stringify(geometryZoomed[pageNumber])) }))
  };
  checkpoint('zoom-persistence-verified');
  await capture(page, report, '02-cross-page-highlight-zoomed.png');

  const recycle = await recycleNativePages(page, [1, 2], report.metrics.reader.pageCount);
  const geometryRemounted = {};
  for (const pageNumber of [1, 2]) {
    geometryRemounted[pageNumber] = await collectOverlayGeometry(
      page, created.annotationIds, pageNumber);
    assertGeometryStable(geometryZoomed[pageNumber], geometryRemounted[pageNumber],
      `CROSS_PAGE_REMOUNT_PAGE_${pageNumber}`);
  }
  report.metrics.remount = {
    ...recycle,
    pages: [1, 2].map(pageNumber => ({ pageNumber,
      overlayCount: geometryRemounted[pageNumber].length,
      geometrySha256: sha256(JSON.stringify(geometryRemounted[pageNumber])) }))
  };
  checkpoint('virtualized-remount-verified');
  await capture(page, report, '03-cross-page-highlight-remounted.png');

  const exported = await page.evaluate(async () => {
    const bridge = globalThis.__brevessPdfReaderBridge;
    const context = await bridge.command('exportAnnotatedPdf');
    const bytes = context.bytes;
    const verification = await bridge.command('verifyAnnotatedPdf', bytes, context);
    return {
      byteLength: Number(bytes?.byteLength) || 0,
      annotationsDigest: String(context.annotationsDigest || ''),
      annotationCount: context.annotationsSnapshot?.length || 0,
      verified: verification?.ok === true,
      verifiedCount: verification?.verifiedIds?.length || 0,
      missingCount: verification?.missingIds?.length || 0
    };
  });
  assert.ok(exported.byteLength > 1000, 'CROSS_PAGE_EXPORTED_PDF_EMPTY');
  assert.equal(exported.annotationCount, created.annotations.length,
    'CROSS_PAGE_EXPORTED_SEGMENT_COUNT_MISMATCH');
  assert.equal(exported.verified, true, 'CROSS_PAGE_EXPORTED_PDF_ANNOTATIONS_INVALID');
  assert.equal(exported.verifiedCount, created.annotations.length,
    'CROSS_PAGE_EXPORTED_SEGMENTS_NOT_ALL_VERIFIED');
  assert.equal(exported.missingCount, 0, 'CROSS_PAGE_EXPORTED_PDF_ANNOTATIONS_MISSING');
  report.metrics.exported = exported;
  checkpoint('export-reopen-verified', { segmentCount: exported.annotationCount });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForReader(page, sourceHash);
  await waitForManualReady(page, sourceHash);
  const restored = await page.evaluate(ids =>
    (currentManualDocument?.record?.annotations || []).filter(item =>
      ids.includes(String(item?.annotationId || ''))
    ).map(item => structuredClone(item)), created.annotationIds);
  assert.equal(restored.length, created.annotationIds.length,
    'CROSS_PAGE_ANNOTATION_GROUP_NOT_RESTORED');
  const restoredAnchors = restored.flatMap(annotationAnchors)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  assert.equal(sha256(JSON.stringify(restoredAnchors)), created.anchorSha256,
    'CROSS_PAGE_RELOADED_ANCHORS_CHANGED');
  const geometryReloaded = {};
  for (const pageNumber of [1, 2]) {
    geometryReloaded[pageNumber] = await collectOverlayGeometry(
      page, created.annotationIds, pageNumber);
    assertGeometryStable(geometryRemounted[pageNumber], geometryReloaded[pageNumber],
      `CROSS_PAGE_RELOAD_PAGE_${pageNumber}`);
  }
  report.metrics.reload = {
    documentHashMatches: await page.evaluate(hash =>
      globalThis.__brevessNativePdfDocument?.structure?.documentHash === hash, sourceHash),
    annotationIdHashes: created.annotationIdHashes,
    anchorSha256: sha256(JSON.stringify(restoredAnchors)),
    anchorsExact: true,
    pages: [1, 2].map(pageNumber => ({ pageNumber,
      overlayCount: geometryReloaded[pageNumber].length,
      geometrySha256: sha256(JSON.stringify(geometryReloaded[pageNumber])) }))
  };
  assert.equal(report.metrics.reload.documentHashMatches, true,
    'CROSS_PAGE_RELOAD_DOCUMENT_HASH_MISMATCH');
  checkpoint('reload-persistence-verified');
  await capture(page, report, '04-cross-page-highlight-reloaded.png');
  }

  assert.equal(report.network.httpRequests, 0, 'CROSS_PAGE_EXTERNAL_REQUEST_OBSERVED');
  assert.equal(report.network.apiRequests, 0, 'CROSS_PAGE_API_REQUEST_OBSERVED');
  assert.deepEqual(report.diagnostics.pageErrors, [], 'CROSS_PAGE_PAGE_ERROR_OBSERVED');
  assert.deepEqual(report.diagnostics.consoleErrors, [], 'CROSS_PAGE_CONSOLE_ERROR_OBSERVED');
  assert.deepEqual(report.diagnostics.workerErrors, [], 'CROSS_PAGE_WORKER_ERROR_OBSERVED');
  report.status = 'PASS';
  report.elapsedMs = Date.now() - startedAt;
  writeReport(report);
  console.log(JSON.stringify({ status: report.status, outputDirectory,
    sourceSha256: report.source.pdfSha256, pageCount: report.metrics.reader.pageCount,
    selection: report.metrics.selection, annotation: report.metrics.annotation,
    zoom: report.metrics.zoom, remount: report.metrics.remount,
    exported: report.metrics.exported,
    reload: report.metrics.reload,
    samePageVisibleHighlight: report.metrics.samePageVisibleHighlight,
    samePagePersistence: report.metrics.samePagePersistence,
    network: report.network }));
} catch (error) {
  if (error?.evidence) report.metrics.gestureSetupFailure = error.evidence;
  if (page) {
    try { await capture(page, report, '99-failure.png'); } catch (_) { /* best effort */ }
    try {
      report.diagnostics.failureState = await page.evaluate(() => ({
        documentHash: String(globalThis.__brevessNativePdfDocument?.structure?.documentHash || ''),
        nativePhase: String(globalThis.__brevessNativePdfDocument?.phase || ''),
        manualDocumentHash: String(currentManualDocument?.record?.documentHash || ''),
        manualDocumentIdPresent: Boolean(currentManualDocument?.documentId),
        manualCategoryCount: currentManualCategories?.length || 0,
        manualBlockCount: currentManualBlocks?.length || 0,
        manualHasPageOne: currentManualBlocks?.some(block => block.blockId === 'pdf-page-1') || false,
        manualHasPageTwo: currentManualBlocks?.some(block => block.blockId === 'pdf-page-2') || false,
        pageInput: String(document.querySelector('#pdfReaderPageNumber')?.value || ''),
        toolbarVisible: (() => {
          const toolbar = document.querySelector('#sci-manual-toolbar');
          if (!toolbar) return false;
          const style = getComputedStyle(toolbar);
          const rect = toolbar.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
        })(),
        statusVisible: Boolean(document.querySelector('#sci-manual-status')?.offsetParent),
        statusType: String(document.querySelector('#sci-manual-status')?.className || ''),
        statusText: String(document.querySelector('#sci-manual-status')?.textContent || ''),
        annotationCount: currentManualDocument?.record?.annotations?.length || 0
      }));
      const statusText = report.diagnostics.failureState.statusText;
      report.diagnostics.failureState.statusTextSha256 = statusText ? sha256(statusText) : '';
      report.diagnostics.failureState.statusTextBytes = Buffer.byteLength(statusText);
      delete report.diagnostics.failureState.statusText;
    } catch (_) { /* preserve the primary error */ }
  }
  report.status = 'FAIL';
  report.elapsedMs = Date.now() - startedAt;
  report.error = safeError(error);
  writeReport(report);
  console.error(JSON.stringify({ status: report.status, outputDirectory,
    error: report.error, selection: report.metrics.selection || null,
    failureState: report.diagnostics.failureState || null, network: report.network }));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => undefined);
  safeRemoveTemporary(temporaryRoot);
}
