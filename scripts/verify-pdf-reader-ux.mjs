import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(repositoryRoot, 'output', 'playwright', 'pdf-reader-ux-f1');
const sourceHtml = fs.readFileSync(path.join(repositoryRoot, 'pdf-reader.html'), 'utf8');
const sourceCss = fs.readFileSync(path.join(repositoryRoot, 'pdf-reader.css'), 'utf8');
const sourceUi = fs.readFileSync(path.join(repositoryRoot, 'pdf-reader-ui.js'), 'utf8');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixtureMarkup() {
  const withoutResources = sourceHtml
    .replace(/\s*<link[^>]+rel="stylesheet"[^>]*>/gu, '')
    .replace(/\s*<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gu, '');
  return withoutResources
    .replace('</head>', `<style>${sourceCss}</style></head>`)
    .replace('</body>', `<script>${sourceUi}</script></body>`);
}

async function setReadableFailure(page) {
  await page.evaluate(() => {
    document.body.dataset.pdfView = 'original';
    const original = document.getElementById('pdfOriginalViewer');
    const workspace = document.getElementById('pdfReaderWorkspace');
    const native = document.getElementById('pdfNativeViewer');
    const frame = document.getElementById('pdfOriginalFrame');
    const control = document.getElementById('pdfReaderControl');
    original.hidden = false;
    workspace.hidden = true;
    native.dataset.state = 'ready';
    frame.hidden = true;
    control.dataset.state = 'error';
    document.documentElement.dataset.pdfEnhancementState = 'error';
    document.documentElement.dataset.pdfEnhancementError = 'NETWORK_UNAVAILABLE';
    document.getElementById('pdfReaderStatusTitle').textContent = '增强识别未完成';
    document.getElementById('pdfReaderStatus').textContent =
      '无法连接增强识别服务；PDF 原页仍可阅读。';
    document.getElementById('pdfReaderRetry').hidden = false;
    const quota = document.getElementById('pdfMineruQuotaStatus');
    quota.hidden = false;
    quota.textContent = '增强识别配额暂不可用；这不影响原页阅读。';
    const figure = document.getElementById('pdfFigureEngineStatus');
    figure.hidden = false;
    figure.dataset.state = 'fallback';
    figure.textContent = 'Figure 图源仍在检查，可继续阅读原页。';
  });
  await page.waitForFunction(() =>
    document.body.hasAttribute('data-pdf-surface-readable') &&
    document.getElementById('pdfReaderNoticeStack').hidden);
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height,
        top: value.top, right: value.right, bottom: value.bottom, left: value.left };
    };
    const noticeViewport = document.getElementById('pdfReaderNotices').getBoundingClientRect();
    const errorControl = document.getElementById('pdfReaderControl').getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      toolbar: rect('.pdf-reader-toolbar'),
      navigation: rect('.pdf-reader-navigation'),
      notices: rect('#pdfReaderNoticeStack'),
      viewer: rect('#pdfOriginalViewer'),
      documentWidth: document.documentElement.scrollWidth,
      readablePresentation: document.body.hasAttribute('data-pdf-surface-readable'),
      noticeVisible: getComputedStyle(document.getElementById('pdfReaderNoticeStack')).display !== 'none',
      errorControlVisible: errorControl.top >= noticeViewport.top - 1 &&
        errorControl.top < noticeViewport.bottom - 1,
      noticeSummary: document.getElementById('pdfReaderNoticesSummary').textContent.trim(),
      errorTitle: document.getElementById('pdfReaderStatusTitle').textContent.trim(),
      errorMessage: document.getElementById('pdfReaderStatus').textContent.trim(),
      embedHintDisplay: getComputedStyle(document.querySelector('.pdf-original-embed-hint')).display,
      progressTransition: getComputedStyle(document.getElementById('pdfReaderProgressBar')).transitionDuration,
      progressDisplay: getComputedStyle(document.querySelector('.pdf-reader-progress')).display,
      pageAnimation: getComputedStyle(document.querySelector('.pdf-native-page') ||
        document.getElementById('pdfNativeViewer')).animationName
    };
  });
}

fs.mkdirSync(outputDirectory, { recursive: true });
const report = {
  status: 'RUNNING',
  scope: 'production HTML/CSS/display-controller layout fixture; no PDF parser, API, or OCR claim',
  sources: {
    htmlSha256: sha256(sourceHtml),
    cssSha256: sha256(sourceCss),
    uiSha256: sha256(sourceUi)
  },
  checks: [],
  layouts: []
};

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 720, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.setContent(fixtureMarkup(), { waitUntil: 'load' });
    await setReadableFailure(page);
    const normal = await layoutSnapshot(page);
    assert.equal(normal.readablePresentation, true);
    assert.equal(normal.noticeVisible, false);
    assert.equal(normal.errorControlVisible, false);
    assert.equal(normal.errorTitle, '增强识别未完成');
    assert.match(normal.errorMessage, /原页仍可阅读/u);
    assert.match(normal.noticeSummary, /增强识别未完成/u);
    assert.equal(normal.notices.height, 0,
      `status must take no reading space at ${viewport.width}x${viewport.height}`);
    assert.ok(normal.documentWidth <= viewport.width,
      `document overflows horizontally at ${viewport.width}x${viewport.height}`);
    assert.equal(normal.embedHintDisplay, 'none');
    assert.equal(normal.progressTransition, '0s');
    assert.equal(normal.progressDisplay, 'none', 'terminal error must not retain a fake progress bar');

    await page.locator('#pdfReaderFocusToggle').click();
    const focus = await page.evaluate(() => {
      const viewer = document.getElementById('pdfOriginalViewer').getBoundingClientRect();
      return {
        enabled: document.body.hasAttribute('data-reading-focus'),
        viewerHeight: viewer.height,
        viewerRatio: viewer.height / innerHeight,
        navigationDisplay: getComputedStyle(document.querySelector('.pdf-reader-navigation')).display,
        noticeDisplay: getComputedStyle(document.getElementById('pdfReaderNoticeStack')).display,
        exitLabel: document.getElementById('pdfReaderFocusToggle').textContent.trim()
      };
    });
    assert.equal(focus.enabled, true);
    assert.ok(focus.viewerRatio >= 0.85,
      `focus viewer ratio below 85% at ${viewport.width}x${viewport.height}`);
    assert.equal(focus.navigationDisplay, 'none');
    assert.equal(focus.noticeDisplay, 'none');
    assert.equal(focus.exitLabel, '退出专注');

    const editorEscape = await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'temporaryEditor';
      document.body.append(input);
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true,
        cancelable: true }));
      const retained = document.body.hasAttribute('data-reading-focus');
      input.remove();
      return retained;
    });
    assert.equal(editorEscape, true, 'Escape from an editor must not exit focus mode');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('body').getAttribute('data-reading-focus'), null);

    await page.locator('#pdfReaderMoreToggle').click();
    const menu = await page.evaluate(() => {
      const toggle = document.getElementById('pdfReaderMoreToggle');
      const menuNode = document.getElementById('pdfReaderMoreMenu');
      const rect = menuNode.getBoundingClientRect();
      return {
        expanded: toggle.getAttribute('aria-expanded'),
        hidden: menuNode.hidden,
        activeRole: document.activeElement?.getAttribute('role'),
        left: rect.left,
        right: rect.right,
        viewportWidth: innerWidth
      };
    });
    assert.equal(menu.expanded, 'true');
    assert.equal(menu.hidden, false);
    assert.equal(menu.activeRole, 'menuitem');
    assert.ok(menu.left >= 0 && menu.right <= menu.viewportWidth + 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#pdfReaderMoreToggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'pdfReaderMoreToggle');
    await page.locator('#pdfReaderMoreToggle').click();
    await page.locator('#pdfReaderSettingsToggle').click();
    assert.equal(await page.locator('#pdfReaderMoreToggle').getAttribute('aria-expanded'), 'false',
      'activating a menu item must close the menu');

    await page.evaluate(() => {
      document.documentElement.dataset.pdfEnhancementState = 'running';
      document.documentElement.dataset.pdfEnhancementError = '';
      document.getElementById('pdfReaderControl').dataset.state = 'loading';
      document.getElementById('pdfReaderStatus').textContent = '正在准备增强识别；页面可以保持在后台。';
      globalThis.BrevessPdfReaderUI.sync();
    });
    assert.equal(await page.locator('.pdf-reader-progress').evaluate(node =>
      getComputedStyle(node).display), 'none', 'stage-only work must not show a guessed percentage');
    await page.evaluate(() => {
      document.getElementById('pdfReaderControl').dataset.state = 'indexing';
      document.getElementById('pdfReaderStatus').textContent =
        '已检查 7/23 页；当前始终显示 PDF 原页。';
      globalThis.BrevessPdfReaderUI.sync();
    });
    assert.equal(await page.locator('.pdf-reader-progress').isVisible(), false,
      'measured progress is kept for the side panel, never displayed above the PDF');
    assert.equal(await page.locator('.pdf-reader-progress').getAttribute('aria-valuetext'), '7/23 页');
    await page.evaluate(() => {
      document.documentElement.dataset.pdfEnhancementState = 'error';
      document.documentElement.dataset.pdfEnhancementError = 'NETWORK_UNAVAILABLE';
      document.getElementById('pdfReaderControl').dataset.state = 'error';
    });

    const afterProgress = await layoutSnapshot(page);
    assert.deepEqual(afterProgress.viewer, normal.viewer,
      'loading, measured progress and errors must not change PDF geometry');
    await page.locator('#pdfReaderMoreToggle').click();
    assert.equal(await page.locator('#pdfReaderRetry').isVisible(), true,
      'recovery remains available from the toolbar');
    await page.keyboard.press('Escape');

    report.layouts.push({ viewport, normal, focus, menu });
    const filename = `reader-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: path.join(outputDirectory, filename), fullPage: false });
    report.checks.push(`compact-readable-${viewport.width}x${viewport.height}`,
      `focus-${viewport.width}x${viewport.height}`, `keyboard-${viewport.width}x${viewport.height}`);
  }

  await page.evaluate(() => {
    document.getElementById('pdfNativeViewer').dataset.state = 'error';
    document.getElementById('pdfOriginalFrame').hidden = false;
  });
  await page.waitForFunction(() =>
    document.getElementById('pdfOriginalViewer').dataset.renderer === 'iframe');
  assert.equal(await page.locator('.pdf-original-embed-hint').evaluate(node =>
    getComputedStyle(node).display), 'none');
  report.checks.push('iframe-guidance-does-not-cover-reading');

  report.status = 'PASS';
  await context.close();
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length,
    layouts: report.layouts.map(item => ({ viewport: item.viewport,
      noticeRatio: item.normal.notices.height / item.viewport.height,
      focusViewerRatio: item.focus.viewerRatio })) }, null, 2)}\n`);
}
