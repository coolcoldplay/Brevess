import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const pdfPath = path.join(root, 'tmp', 'public-pdf-acceptance', 'elife-83176-v2.pdf');
const outputDirectory = path.join(root, 'output', 'playwright', 'pdf-highlight-visual-f3');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-highlight-f3-'));
const temporaryExtension = path.join(temporaryRoot, 'extension');
const profileDirectory = path.join(temporaryRoot, 'profile');
const expectedPdfHash = '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function safeRemoveTemporary(target) {
  const temp = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (resolved.startsWith(temp + path.sep) &&
      path.basename(resolved).startsWith('brevess-pdf-highlight-f3-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function copyExtension() {
  fs.mkdirSync(temporaryExtension, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, directory), path.join(temporaryExtension, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(temporaryExtension, file));
    }
  }
}

async function waitForReader(page, sourceHash) {
  await page.waitForFunction(hash => {
    const native = globalThis.__brevessNativePdfDocument;
    const pageTwo = document.querySelector('.pdf-native-page[data-pdf-page-number="2"]');
    return document.querySelector('#pdfNativeViewer')?.dataset?.state === 'ready' &&
      native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
      Number(native?.pageCount) === 23 && pageTwo &&
      document.documentElement.dataset.pdfWorkspaceReady === 'true' &&
      document.documentElement.dataset.pdfWorkspaceIndexed === 'true';
  }, sourceHash, { timeout: 120_000 });
}

async function waitForManualReady(page, sourceHash) {
  const ready = hash => {
    try {
      return String(currentManualDocument?.record?.documentHash || '').replace(/^sha256:/u, '') === hash &&
        currentManualDocument?.documentId && currentManualCategories?.length > 0 &&
        currentManualBlocks?.some(block => /^pdf-page-\d+$/u.test(block.blockId || ''));
    } catch {
      return false;
    }
  };
  let recoveryInvoked = false;
  try {
    await page.waitForFunction(ready, sourceHash, { timeout: 15_000 });
  } catch (error) {
    recoveryInvoked = true;
    const beforeRecovery = await page.evaluate(() => {
      try {
        return {
          documentHash: String(currentManualDocument?.record?.documentHash || ''),
          documentIdPresent: Boolean(currentManualDocument?.documentId),
          categoryCount: Number(currentManualCategories?.length) || 0,
          blockCount: Number(currentManualBlocks?.length) || 0,
          pdfBlockCount: (currentManualBlocks || []).filter(block =>
            /^pdf-page-\d+$/u.test(block.blockId || '')).length
        };
      } catch (diagnosticError) {
        return { exception: String(diagnosticError?.message || diagnosticError) };
      }
    });
    await page.evaluate(async () => {
      if (typeof prepareManualDocument !== 'function') throw new Error('F3_MANUAL_PREPARE_UNAVAILABLE');
      await prepareManualDocument({ force: true });
    });
    try {
      await page.waitForFunction(ready, sourceHash, { timeout: 30_000 });
    } catch (recoveryError) {
      throw new Error(`F3_MANUAL_READY_TIMEOUT:${JSON.stringify(beforeRecovery)}`, {
        cause: recoveryError
      });
    }
  }
  return { recoveryInvoked };
}

async function navigatePage(page, pageNumber) {
  const input = page.locator('#pdfReaderPageNumber');
  await input.fill(String(pageNumber));
  await input.press('Enter');
  await input.evaluate(node => node.dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForFunction(number => {
    const pageNode = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${number}"]`);
    return pageNode?.classList.contains('is-rendered') &&
      pageNode.querySelectorAll('.pdf-native-text-layer span').length > 0 &&
      pageNode.querySelector('canvas')?.width > 0;
  }, pageNumber, { timeout: 30_000 });
}

async function targetSpan(page) {
  await page.evaluate(() => globalThis.__brevessPdfReaderBridge?.command?.('focusPage', 1));
  const firstPage = page.locator('.pdf-native-page[data-pdf-page-number="1"]');
  await firstPage.waitFor({ state: 'visible', timeout: 15_000 });
  await firstPage.scrollIntoViewIfNeeded();
  const spans = page.locator(
    '.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span'
  );
  await page.waitForFunction(() => Array.from(document.querySelectorAll(
    '.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span'
  )).some(node => {
    const rect = node.getBoundingClientRect();
    return String(node.textContent || '').trim().length >= 22 &&
      rect.width >= 70 && rect.height >= 6 && rect.bottom > 0 && rect.top < innerHeight;
  }), null, { timeout: 15_000 });
  const target = await spans.evaluateAll(nodes => {
    const node = nodes.find(item => {
      const rect = item.getBoundingClientRect();
      return String(item.textContent || '').trim().length >= 22 &&
        rect.width >= 70 && rect.height >= 6 && rect.bottom > 0 && rect.top < innerHeight;
    });
    const rect = node?.getBoundingClientRect();
    return rect ? { text: String(node.textContent || ''),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : null;
  });
  assert.ok(target, 'F3_BODY_TEXT_TARGET_MISSING');
  assert.ok(target.box?.width >= 70 && target.box?.height >= 6,
    'F3_BODY_TEXT_TARGET_NOT_VISIBLE');
  return target;
}

async function mouseSelect(page, targetText, startRatio, endRatio) {
  const box = await page.locator(
    '.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span'
  ).evaluateAll((nodes, text) => {
    const target = nodes.find(node => String(node.textContent || '') === text);
    const rect = target?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  }, targetText);
  assert.ok(box, 'F3_SELECTION_TARGET_DETACHED');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + Math.max(2, box.width * startRatio), y);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 2, box.width * endRatio), y, { steps: 24 });
  await page.mouse.up();
  await page.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 10_000 });
  return page.evaluate(() => {
    const range = getSelection()?.rangeCount ? getSelection().getRangeAt(0) : null;
    const rects = range ? [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0) : [];
    const selection = rects.length ? {
      left: Math.min(...rects.map(rect => rect.left)),
      top: Math.min(...rects.map(rect => rect.top)),
      right: Math.max(...rects.map(rect => rect.right)),
      bottom: Math.max(...rects.map(rect => rect.bottom))
    } : null;
    const toolbarRect = document.querySelector('#sci-manual-toolbar')?.getBoundingClientRect();
    const overlap = selection && toolbarRect
      ? Math.max(0, Math.min(selection.right, toolbarRect.right) -
        Math.max(selection.left, toolbarRect.left)) *
        Math.max(0, Math.min(selection.bottom, toolbarRect.bottom) -
        Math.max(selection.top, toolbarRect.top)) : 0;
    const selectedSpan = range?.startContainer?.parentElement?.closest?.(
      '.pdf-native-text-layer span');
    return {
      characters: String(getSelection() || '').trim().length,
      selection, toolbar: toolbarRect ? {
        left: toolbarRect.left, top: toolbarRect.top,
        right: toolbarRect.right, bottom: toolbarRect.bottom,
        width: toolbarRect.width, height: toolbarRect.height
      } : null,
      toolbarIntersectionPixels: overlap,
      selectionBackground: selectedSpan
        ? getComputedStyle(selectedSpan, '::selection').backgroundColor : ''
    };
  });
}

function clipForBox(box) {
  const padding = 5;
  return {
    x: Math.max(0, Math.floor(box.x - padding)),
    y: Math.max(0, Math.floor(box.y - padding)),
    width: Math.ceil(box.width + padding * 2),
    height: Math.ceil(box.height + padding * 2)
  };
}

async function writeScreenshot(page, name, options = {}) {
  const target = path.join(outputDirectory, name);
  const bytes = await page.screenshot({ path: target, fullPage: false, ...options });
  return { name, bytes: bytes.length, sha256: sha256File(target), buffer: bytes };
}

async function comparePng(page, baseline, variant) {
  return page.evaluate(async ({ baselineBase64, variantBase64 }) => {
    const pixels = async base64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height,
        data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const before = await pixels(baselineBase64);
    const after = await pixels(variantBase64);
    if (before.width !== after.width || before.height !== after.height) {
      throw new Error('F3_SCREENSHOT_DIMENSIONS_CHANGED');
    }
    const luminance = (red, green, blue) => .2126 * red + .7152 * green + .0722 * blue;
    let inkPixels = 0;
    let retainedInkPixels = 0;
    let inkLuminance = 0;
    let backgroundPixels = 0;
    let backgroundLuminance = 0;
    let changedPixels = 0;
    let absoluteDifference = 0;
    for (let offset = 0; offset < before.data.length; offset += 4) {
      const beforeLuma = luminance(before.data[offset], before.data[offset + 1], before.data[offset + 2]);
      const afterLuma = luminance(after.data[offset], after.data[offset + 1], after.data[offset + 2]);
      const difference = (Math.abs(before.data[offset] - after.data[offset]) +
        Math.abs(before.data[offset + 1] - after.data[offset + 1]) +
        Math.abs(before.data[offset + 2] - after.data[offset + 2])) / 3;
      absoluteDifference += difference;
      if (difference > 3) changedPixels += 1;
      if (beforeLuma < 105) {
        inkPixels += 1;
        inkLuminance += afterLuma;
        if (afterLuma < 150) retainedInkPixels += 1;
      } else if (beforeLuma > 225) {
        backgroundPixels += 1;
        backgroundLuminance += afterLuma;
      }
    }
    const meanInk = inkPixels ? inkLuminance / inkPixels : 255;
    const meanBackground = backgroundPixels ? backgroundLuminance / backgroundPixels : 255;
    const contrast = (Math.max(meanInk, meanBackground) + 12.75) /
      (Math.min(meanInk, meanBackground) + 12.75);
    const totalPixels = before.width * before.height;
    return {
      width: before.width, height: before.height,
      inkPixels,
      inkRetention: inkPixels ? retainedInkPixels / inkPixels : 0,
      inkLossRatio: inkPixels ? 1 - retainedInkPixels / inkPixels : 1,
      approximateContrast: contrast,
      changedPixelRatio: changedPixels / totalPixels,
      meanAbsoluteRgbDifference: absoluteDifference / totalPixels
    };
  }, {
    baselineBase64: baseline.toString('base64'),
    variantBase64: variant.toString('base64')
  });
}

async function createdAnnotationIds(page, baselineIds) {
  return page.evaluate(prior =>
    (currentManualDocument?.record?.annotations || [])
      .map(item => String(item?.annotationId || ''))
      .filter(id => id && !prior.includes(id)), baselineIds);
}

async function waitForCreatedCount(page, baselineIds, expected) {
  await page.waitForFunction(({ prior, count }) =>
    (currentManualDocument?.record?.annotations || []).filter(item =>
      !prior.includes(String(item?.annotationId || ''))).length >= count,
  { prior: baselineIds, count: expected }, { timeout: 15_000 });
  return createdAnnotationIds(page, baselineIds);
}

async function overlayMetrics(page, annotationIds) {
  await page.waitForFunction(ids => ids.every(id => document.querySelector(
    `.pdf-native-annotation-hit[data-annotation-id="${CSS.escape(id)}"]`)),
  annotationIds, { timeout: 15_000 });
  return page.evaluate(ids => {
    const hits = ids.map(id => document.querySelector(
      `.pdf-native-annotation-hit[data-annotation-id="${CSS.escape(id)}"]`));
    const records = hits.map(hit => {
      const rect = hit.getBoundingClientRect();
      const style = getComputedStyle(hit);
      return { annotationId: hit.dataset.annotationId,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height },
        background: style.backgroundColor, boxShadow: style.boxShadow,
        borderRadius: style.borderRadius, pointerEvents: style.pointerEvents };
    });
    let overlapPixels = 0;
    if (records.length >= 2) {
      const [first, second] = records.map(item => item.rect);
      overlapPixels = Math.max(0, Math.min(first.right, second.right) -
        Math.max(first.left, second.left)) *
        Math.max(0, Math.min(first.bottom, second.bottom) -
        Math.max(first.top, second.top));
    }
    return { records, overlapPixels };
  }, annotationIds);
}

async function responsiveLayout(page, viewport) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => globalThis.__brevessPdfReaderBridge?.command?.('fitWidth'));
  await page.waitForTimeout(350);
  const metrics = await page.evaluate(() => {
    const ids = ['pdfReaderStudy', 'pdfReaderZoomOut', 'pdfReaderZoomIn',
      'pdfReaderZoomReset', 'pdfReaderFocusToggle', 'pdfReaderMoreToggle',
      'pdfReaderPageNumber', 'pdfReaderFind'];
    const controls = ids.map(id => {
      const node = document.getElementById(id);
      const rect = node?.getBoundingClientRect();
      return { id, visible: Boolean(node && !node.hidden && rect?.width > 0 && rect?.height > 0),
        left: rect?.left || 0, right: rect?.right || 0,
        top: rect?.top || 0, bottom: rect?.bottom || 0 };
    });
    return { viewport: { width: innerWidth, height: innerHeight }, controls,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth };
  });
  assert.ok(metrics.controls.every(item => item.visible && item.left >= 0 &&
    item.right <= viewport.width + 1 && item.top >= 0 && item.bottom <= viewport.height + 1),
  `F3_CONTROLS_OUT_OF_VIEW_${viewport.width}`);
  assert.ok(metrics.documentScrollWidth <= viewport.width && metrics.bodyScrollWidth <= viewport.width,
    `F3_DOCUMENT_OVERFLOW_${viewport.width}`);
  await page.locator('#pdfReaderMoreToggle').click();
  const menu = await page.locator('#pdfReaderMoreMenu').boundingBox();
  assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= viewport.width + 1,
    `F3_MORE_MENU_OVERFLOW_${viewport.width}`);
  await page.keyboard.press('Escape');
  return metrics;
}

async function statusContract(page) {
  return page.evaluate(async () => {
    const rootNode = document.documentElement;
    const control = document.getElementById('pdfReaderControl');
    const status = document.getElementById('pdfReaderStatus');
    const title = document.getElementById('pdfReaderStatusTitle');
    const retry = document.getElementById('pdfReaderRetry');
    const progress = control.querySelector('.pdf-reader-progress');
    const bar = document.getElementById('pdfReaderProgressBar');
    const frame = () => new Promise(resolve => requestAnimationFrame(() =>
      requestAnimationFrame(resolve)));
    control.hidden = false;
    control.dataset.state = 'indexing';
    title.textContent = '正在建立文字索引';
    status.textContent = '已检查 7/23 页；当前始终显示 PDF 原页。';
    globalThis.BrevessPdfReaderUI.sync();
    await frame();
    const measured = { kind: control.dataset.progressKind, hidden: progress.hidden,
      ariaHidden: progress.getAttribute('aria-hidden'),
      valueNow: progress.getAttribute('aria-valuenow'),
      valueMax: progress.getAttribute('aria-valuemax'),
      valueText: progress.getAttribute('aria-valuetext'), width: bar.style.width };
    control.dataset.state = 'loading';
    status.textContent = '正在准备增强识别；页面可以保持在后台。';
    globalThis.BrevessPdfReaderUI.sync();
    await frame();
    const stageOnly = { kind: control.dataset.progressKind, hidden: progress.hidden,
      ariaHidden: progress.getAttribute('aria-hidden'), valueNow: progress.getAttribute('aria-valuenow') };
    rootNode.dataset.pdfEnhancementState = 'error';
    rootNode.dataset.pdfEnhancementError = 'NETWORK_UNAVAILABLE';
    control.dataset.state = 'error';
    title.textContent = '增强识别未完成';
    status.textContent = '增强识别失败；PDF 原页仍可阅读。';
    retry.hidden = false;
    globalThis.BrevessPdfReaderUI.sync();
    await frame();
    const statusRect = control.getBoundingClientRect();
    document.getElementById('pdfReaderMoreToggle').click();
    const first = { top: statusRect.top, height: statusRect.height,
      progressHidden: progress.hidden,
      retryVisible: !retry.hidden && retry.getBoundingClientRect().width > 0,
      animations: [...control.querySelectorAll('*')].map(node =>
        getComputedStyle(node).animationName).filter(value => value !== 'none'),
      noticeRatio: document.getElementById('pdfReaderNoticeStack').getBoundingClientRect().height / innerHeight };
    await new Promise(resolve => setTimeout(resolve, 650));
    const laterRect = control.getBoundingClientRect();
    const later = { top: laterRect.top, height: laterRect.height,
      progressHidden: progress.hidden };
    globalThis.BrevessPdfReaderUI.setMoreMenu(false);
    return { measured, stageOnly, terminal: first, terminalLater: later };
  });
}

fs.mkdirSync(outputDirectory, { recursive: true });
const report = {
  status: 'RUNNING',
  visualStatus: 'RUNNING',
  initializationStatus: 'RUNNING',
  scope: 'Current-source real native-text PDF selection and persistent annotation visual UX; no OCR/API.',
  source: {},
  isolation: { temporaryExtension: true, temporaryProfile: true,
    dailyBrowserUsed: false, computerUseUsed: false },
  network: { httpRequests: 0, apiRequests: 0, blockedOrigins: [] },
  diagnostics: { pageErrors: [], consoleErrors: [] },
  metrics: {}, screenshots: [],
  limitations: [
    'This visual verifier does not establish semantic selection boundaries or diagnose page-header contamination.',
    'No OCR, model action, remote upload, or annotated-PDF disk export is performed.',
    'The terminal error presentation is exercised on the real loaded PDF DOM without inducing a remote service failure.'
  ]
};

let context;
try {
  assert.equal(sha256File(pdfPath), expectedPdfHash, 'F3_PUBLIC_PDF_HASH_MISMATCH');
  copyExtension();
  report.source = {
    pdfSha256: expectedPdfHash,
    htmlSha256: sha256File(path.join(temporaryExtension, 'pdf-reader.html')),
    cssSha256: sha256File(path.join(temporaryExtension, 'pdf-reader.css')),
    uiSha256: sha256File(path.join(temporaryExtension, 'pdf-reader-ui.js'))
  };
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${temporaryExtension}`,
      `--load-extension=${temporaryExtension}`]
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  context.on('request', request => {
    if (!/^https?:\/\//u.test(request.url())) return;
    report.network.httpRequests += 1;
    if (/(?:api\.|openai|deepseek|mineru|chat\/completions|responses)/iu.test(request.url())) {
      report.network.apiRequests += 1;
    }
    try {
      const origin = new URL(request.url()).origin;
      if (!report.network.blockedOrigins.includes(origin)) report.network.blockedOrigins.push(origin);
    } catch { /* origin is diagnostic only */ }
  });
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.__f3LifecycleEvents = {
      nativeReady: 0, pageRendered: 0, annotationsUpdated: 0
    };
    document.addEventListener('brevess:native-pdf-ready', () => {
      globalThis.__f3LifecycleEvents.nativeReady += 1;
    });
    document.addEventListener('brevess:pdf-page-rendered', () => {
      globalThis.__f3LifecycleEvents.pageRendered += 1;
    });
    document.addEventListener('brevess:pdf-annotations-updated', () => {
      globalThis.__f3LifecycleEvents.annotationsUpdated += 1;
    });
  });
  page.on('pageerror', error => report.diagnostics.pageErrors.push(String(error.message)));
  page.on('console', message => {
    if (message.type() === 'error') report.diagnostics.consoleErrors.push(message.text());
  });
  await page.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
    waitUntil: 'domcontentloaded'
  });
  await page.locator('#pdfLocalFile').setInputFiles(pdfPath);
  await waitForReader(page, expectedPdfHash);
  const initialManualPreparation = await waitForManualReady(page, expectedPdfHash);
  report.metrics.manualInitialization = { initial: initialManualPreparation };
  const baselineIds = await page.evaluate(() =>
    (currentManualDocument?.record?.annotations || []).map(item => String(item.annotationId || '')));
  assert.deepEqual(baselineIds, [], 'F3_TEMP_PROFILE_NOT_CLEAN');
  await navigatePage(page, 1);
  const target = await targetSpan(page);
  const clip = clipForBox(target.box);
  const baselineClip = await writeScreenshot(page, 'target-00-before.png', { clip });

  const selection = await mouseSelect(page, target.text, 0, .68);
  assert.ok(selection.characters >= 16, 'F3_SELECTION_TOO_SHORT');
  assert.equal(selection.toolbarIntersectionPixels, 0, 'F3_TOOLBAR_INTERSECTS_SELECTION');
  assert.match(selection.selectionBackground, /(?:0\.22|22%|\.22)/u);
  const selectionFull = await writeScreenshot(page, '01-native-selection-1440x1000.png');
  const selectionClip = await writeScreenshot(page, 'target-01-selection.png', { clip });
  const selectionPixels = await comparePng(page, baselineClip.buffer, selectionClip.buffer);
  report.metrics.selectionPixels = selectionPixels;
  assert.ok(selectionPixels.inkRetention >= .85, 'F3_SELECTION_GLYPHS_OBSCURED');
  assert.ok(selectionPixels.approximateContrast >= 3,
    `F3_SELECTION_TEXT_CONTRAST_LOW:${JSON.stringify(selectionPixels)}`);

  const categories = page.locator('#sci-manual-toolbar .sci-manual-category:visible');
  assert.ok(await categories.count() >= 2, 'F3_TWO_CATEGORIES_REQUIRED');
  await categories.nth(0).click();
  const firstIds = await waitForCreatedCount(page, baselineIds, 1);
  assert.equal(firstIds.length, 1, 'F3_FIRST_ANNOTATION_COUNT');
  const savedFull = await writeScreenshot(page, '02-saved-annotation-1440x1000.png');
  const savedClip = await writeScreenshot(page, 'target-02-saved.png', { clip });
  const savedPixels = await comparePng(page, baselineClip.buffer, savedClip.buffer);
  report.metrics.savedPixels = savedPixels;
  assert.ok(savedPixels.inkRetention >= .88, 'F3_SAVED_ANNOTATION_GLYPHS_OBSCURED');
  assert.ok(savedPixels.approximateContrast >= 3, 'F3_SAVED_ANNOTATION_TEXT_CONTRAST_LOW');

  const secondSelection = await mouseSelect(page, target.text, .34, .92);
  assert.equal(secondSelection.toolbarIntersectionPixels, 0, 'F3_SECOND_TOOLBAR_INTERSECTS_SELECTION');
  await page.locator('#sci-manual-toolbar .sci-manual-category:visible').nth(1).click();
  const allIds = await waitForCreatedCount(page, baselineIds, 2);
  assert.equal(allIds.length, 2, 'F3_OVERLAP_ANNOTATION_COUNT');
  const overlap = await overlayMetrics(page, allIds);
  assert.ok(overlap.overlapPixels > 20, 'F3_PERSISTENT_ANNOTATIONS_DO_NOT_OVERLAP');
  assert.ok(overlap.records.every(item => item.pointerEvents === 'auto' &&
    /(?:\/\s*0\.08\)|,\s*0\.08\))/u.test(item.background)),
  'F3_SAVED_FILL_NOT_LOW_OBSTRUCTION');
  const overlapFull = await writeScreenshot(page, '03-overlapping-annotations-1440x1000.png');
  const overlapClip = await writeScreenshot(page, 'target-03-overlap.png', { clip });
  const overlapPixels = await comparePng(page, baselineClip.buffer, overlapClip.buffer);
  const overlapDifference = await comparePng(page, savedClip.buffer, overlapClip.buffer);
  report.metrics.overlapPixels = overlapPixels;
  report.metrics.overlapDifference = overlapDifference;
  assert.ok(overlapPixels.inkRetention >= .82, 'F3_OVERLAP_GLYPHS_OBSCURED');
  assert.ok(overlapPixels.approximateContrast >= 3, 'F3_OVERLAP_TEXT_CONTRAST_LOW');
  assert.ok(overlapDifference.changedPixelRatio >= .03,
    'F3_OVERLAP_NOT_VISUALLY_DISTINGUISHABLE');

  report.metrics.selection = selection;
  report.metrics.annotationOverlay = overlap;
  report.screenshots.push(selectionFull.name, savedFull.name, overlapFull.name,
    baselineClip.name, selectionClip.name, savedClip.name, overlapClip.name);

  report.metrics.layouts = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 720, height: 900 }
  ]) {
    report.metrics.layouts.push(await responsiveLayout(page, viewport));
    const artifact = await writeScreenshot(page, `04-reader-${viewport.width}x${viewport.height}.png`);
    report.screenshots.push(artifact.name);
  }

  report.metrics.status = await statusContract(page);
  assert.deepEqual({ ...report.metrics.status.measured, width: undefined },
    { kind: 'measured', hidden: false, ariaHidden: 'false', valueNow: '7',
      valueMax: '23', valueText: '7/23 页', width: undefined });
  assert.ok(Math.abs(parseFloat(report.metrics.status.measured.width) - 7 / 23 * 100) < .001);
  assert.deepEqual(report.metrics.status.stageOnly,
    { kind: 'stage', hidden: true, ariaHidden: 'true', valueNow: null });
  assert.equal(report.metrics.status.terminal.progressHidden, true);
  assert.equal(report.metrics.status.terminal.retryVisible, true);
  assert.deepEqual(report.metrics.status.terminal.animations, []);
  assert.equal(report.metrics.status.terminal.noticeRatio, 0);
  assert.deepEqual(report.metrics.status.terminalLater, {
    top: report.metrics.status.terminal.top,
    height: report.metrics.status.terminal.height,
    progressHidden: true
  });
  const statusShot = await writeScreenshot(page, '05-terminal-error-compact-720x900.png');
  report.screenshots.push(statusShot.name);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForReader(page, expectedPdfHash);
  const reloadManualPreparation = await waitForManualReady(page, expectedPdfHash);
  report.metrics.manualInitialization.reload = reloadManualPreparation;
  await navigatePage(page, 1);
  const restoredIds = await page.evaluate(ids =>
    (currentManualDocument?.record?.annotations || []).map(item => String(item.annotationId || ''))
      .filter(id => ids.includes(id)).sort(), allIds);
  assert.deepEqual(restoredIds, [...allIds].sort(), 'F3_ANNOTATIONS_NOT_RESTORED');
  const restored = await overlayMetrics(page, allIds);
  assert.equal(restored.records.length, 2);
  assert.ok(restored.overlapPixels > 20, 'F3_RELOADED_OVERLAP_MISSING');
  report.metrics.persistence = { savedIds: allIds.length, restoredIds: restoredIds.length,
    overlapPixelsBefore: overlap.overlapPixels, overlapPixelsAfter: restored.overlapPixels,
    stylesBefore: overlap.records.map(item => ({ background: item.background,
      boxShadow: item.boxShadow })),
    stylesAfter: restored.records.map(item => ({ background: item.background,
      boxShadow: item.boxShadow })) };
  const reloaded = await writeScreenshot(page, '06-overlapping-annotations-reloaded-720x900.png');
  report.screenshots.push(reloaded.name);

  report.metrics.finalState = await page.evaluate(() => ({
    lifecycleEvents: { ...(globalThis.__f3LifecycleEvents || {}) },
    nativeState: String(document.getElementById('pdfNativeViewer')?.dataset?.state || ''),
    nativePhase: String(globalThis.__brevessNativePdfDocument?.phase || ''),
    nativeDocumentHash: String(
      globalThis.__brevessNativePdfDocument?.structure?.documentHash || ''),
    workspaceReady: String(document.documentElement.dataset.pdfWorkspaceReady || ''),
    workspaceIndexed: String(document.documentElement.dataset.pdfWorkspaceIndexed || ''),
    enhancementState: String(document.documentElement.dataset.pdfEnhancementState || ''),
    readerControlState: String(document.getElementById('pdfReaderControl')?.dataset?.state || ''),
    progressKind: String(document.getElementById('pdfReaderControl')?.dataset?.progressKind || ''),
    manualDocumentReady: Boolean(currentManualDocument?.documentId),
    manualCategoryCount: Number(currentManualCategories?.length) || 0,
    manualBlockCount: Number(currentManualBlocks?.length) || 0,
    manualAnnotationCount: Number(currentManualDocument?.record?.annotations?.length) || 0
  }));

  assert.equal(report.network.apiRequests, 0);
  assert.equal(report.network.httpRequests, 0);
  assert.deepEqual(report.diagnostics.pageErrors, []);
  assert.deepEqual(report.diagnostics.consoleErrors, []);
  const forcedRecovery = initialManualPreparation.recoveryInvoked ||
    reloadManualPreparation.recoveryInvoked;
  report.metrics.manualInitialization.autoInitialization = !forcedRecovery;
  report.metrics.manualInitialization.forcedRecovery = forcedRecovery;
  report.visualStatus = 'PASS';
  report.initializationStatus = forcedRecovery ? 'NO_GO' : 'PASS';
  report.status = forcedRecovery ? 'NO_GO' : 'PASS';
  if (forcedRecovery) process.exitCode = 2;
  report.finishedAt = new Date().toISOString();
} catch (error) {
  report.status = 'FAIL';
  report.visualStatus = 'FAIL';
  report.initializationStatus = 'UNRESOLVED';
  report.error = String(error?.stack || error);
  report.finishedAt = new Date().toISOString();
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => undefined);
  safeRemoveTemporary(temporaryRoot);
  fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status,
    visualStatus: report.visualStatus, initializationStatus: report.initializationStatus,
    error: report.error || '',
    selectionInkRetention: report.metrics.selectionPixels?.inkRetention,
    savedInkRetention: report.metrics.savedPixels?.inkRetention,
    overlapInkRetention: report.metrics.overlapPixels?.inkRetention,
    overlapDifference: report.metrics.overlapDifference?.changedPixelRatio,
    persistence: report.metrics.persistence,
    network: report.network }, null, 2)}\n`);
}
