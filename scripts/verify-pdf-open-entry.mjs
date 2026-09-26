import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.join(scriptDirectory, '..'));
const pdfPath = path.resolve(process.env.SCI_PUBLIC_PDF_PATH ||
  path.join(root, 'tmp/public-pdf-acceptance/elife-83176-v2.pdf'));
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR ||
  path.join(root, 'output/playwright/pdf-open-entry-r8'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-open-entry-'));
const extension = path.join(temporary, 'extension');
const profile = path.join(temporary, 'profile');
const report = {
  status: 'FAIL',
  scenario: 'isolated PDF open-entry acceptance with a local public eLife PDF',
  publicLocalPdf: true,
  remoteNavigationOnly: true,
  provider: 'none',
  providerApiCalls: 0,
  blockedHttpRequests: [],
  checks: [],
  screenshots: []
};
let context;

function check(name, condition, details) {
  assert.ok(condition, details === undefined ? name : `${name}: ${JSON.stringify(details)}`);
  report.checks.push(details === undefined ? { name, pass: true } : { name, pass: true, details });
  process.stdout.write(`PASS ${name}\n`);
}

function copyExtension() {
  fs.mkdirSync(extension, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
  }
}

async function waitForNewPage(action) {
  const existing = new Set(context.pages());
  const created = context.waitForEvent('page');
  await action();
  const candidate = await created;
  if (!existing.has(candidate)) return candidate;
  return context.pages().find(page => !existing.has(page)) || candidate;
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  assert.ok(fs.statSync(pdfPath).isFile() && fs.statSync(pdfPath).size > 100_000,
    `public eLife PDF is missing or too small: ${pdfPath}`);
  copyExtension();
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge',
      headless: true,
      reducedMotion: 'reduce',
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1.25,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    await context.route(/^https?:\/\//u, route => {
      const url = route.request().url();
      report.blockedHttpRequests.push(url);
      if (/(?:mineru|api\.openai|api\.anthropic|generativelanguage|api\.deepseek|\/chat\/completions|\/responses(?:\?|$))/iu.test(url)) {
        report.providerApiCalls += 1;
      }
      return route.abort('blockedbyclient');
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const extensionBase = `chrome-extension://${extensionId}/`;

    const actionPage = await context.newPage();
    await actionPage.goto(`${extensionBase}action-popup.html`, { waitUntil: 'domcontentloaded' });
    const reader = await waitForNewPage(() => actionPage.locator('#openPdf').click());
    await reader.waitForURL(url => url.pathname.endsWith('/pdf-reader.html'), {
      timeout: 20_000
    });
    await reader.waitForLoadState('domcontentloaded');
    check('action popup opens the no-source PDF reader',
      new URL(reader.url()).pathname.endsWith('/pdf-reader.html') &&
      !new URL(reader.url()).searchParams.has('source'));
    await reader.locator('#pdfLocalFileFallback').waitFor({ state: 'visible' });
    check('no-source reader offers both local and remote inputs',
      await reader.locator('#pdfLocalFile').isVisible() &&
      await reader.locator('#pdfRemoteUrl').isVisible() &&
      await reader.locator('#pdfRemoteUrlOpen').isVisible());

    const localPageErrors = [];
    reader.on('pageerror', error => localPageErrors.push(error.stack || error.message));
    await reader.locator('#pdfLocalFile').setInputFiles(pdfPath);
    await reader.waitForFunction(() => {
      const native = globalThis.__brevessNativePdfDocument;
      return ['text-ready', 'partial-index'].includes(native?.phase) &&
        native?.structure?.documentHash && native?.pageCount > 0 &&
        document.body.dataset.pdfView === 'original';
    }, null, { timeout: 120_000 });
    await reader.evaluate(() => globalThis.__brevessNativePdfDocument?.focusPage?.(1));
    const canvasEvidence = await reader.evaluate(async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const canvas = document.querySelector(
          '.pdf-native-page[data-pdf-page-number="1"].is-rendered canvas');
        if (canvas?.width && canvas?.height) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (!canvas.isConnected || !canvas.width || !canvas.height) continue;
          const pixels = canvas.getContext('2d', { willReadFrequently: true })
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let inkSamples = 0;
          for (let y = 0; y < canvas.height; y += 12) {
            for (let x = 0; x < canvas.width; x += 12) {
              const index = (y * canvas.width + x) * 4;
              if (pixels[index + 3] > 0 &&
                  (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)) {
                inkSamples += 1;
              }
            }
          }
          if (inkSamples > 100) {
            return {
              width: canvas.width,
              height: canvas.height,
              inkSamples,
              dataUrl: canvas.toDataURL('image/png')
            };
          }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('PDF_ENTRY_NONWHITE_CANVAS_TIMEOUT');
    });
    const localState = await reader.evaluate(() => {
      const native = globalThis.__brevessNativePdfDocument;
      return {
        phase: native?.phase || '',
        pageCount: native?.pageCount || 0,
        paragraphCount: native?.structure?.paragraphs?.length || 0,
        documentHash: native?.structure?.documentHash || '',
        view: document.body.dataset.pdfView || '',
        originalVisible: !document.querySelector('#pdfOriginalViewer')?.hidden,
        parsedVisible: !document.querySelector('#pdfReaderWorkspace')?.hidden,
        parsedRendered: document.documentElement.dataset.pdfWorkspaceRendered || '',
        localSource: document.documentElement.dataset.pdfSourceUrl || ''
      };
    });
    const renderedPagePath = path.join(output, 'local-elife-page-1-canvas.png');
    fs.writeFileSync(renderedPagePath, Buffer.from(
      String(canvasEvidence.dataUrl).replace(/^data:image\/png;base64,/u, ''), 'base64'
    ));
    const renderedPagePng = fs.readFileSync(renderedPagePath);
    localState.pageImage = {
      width: renderedPagePng.readUInt32BE(16),
      height: renderedPagePng.readUInt32BE(20),
      bytes: renderedPagePng.length,
      inkSamples: canvasEvidence.inkSamples,
      nonWhiteCanvasVerified: canvasEvidence.inkSamples > 100
    };
    report.screenshots.push(path.relative(root, renderedPagePath).replaceAll('\\', '/'));
    report.localPdf = {
      ...localState,
      fileName: path.basename(pdfPath),
      bytes: fs.statSync(pdfPath).size,
      pageErrors: localPageErrors
    };
    check('public eLife file loads as an original-page PDF with local text indexing',
      localState.pageCount > 1 && localState.paragraphCount > 0 &&
      /^[a-f0-9]{64}$/u.test(localState.documentHash) &&
      localState.view === 'original' && localState.originalVisible &&
      !localState.parsedVisible &&
      localState.pageImage.width > 300 && localState.pageImage.height > 300 &&
      localState.pageImage.bytes > 50_000 && localState.pageImage.inkSamples > 100 &&
      localState.localSource.startsWith('file:///brevess-local-pdf/'), localState);
    check('local original-page reading raises no page error', localPageErrors.length === 0,
      localPageErrors);
    check('opening and indexing the local PDF makes no HTTP or provider request',
      report.blockedHttpRequests.length === 0 && report.providerApiCalls === 0,
      { blockedHttpRequests: report.blockedHttpRequests,
        providerApiCalls: report.providerApiCalls });
    const localScreenshot = path.join(output, 'local-elife-original-page.png');
    await reader.screenshot({ path: localScreenshot, fullPage: false });
    report.screenshots.push(path.relative(root, localScreenshot).replaceAll('\\', '/'));

    const options = await context.newPage();
    await options.goto(`${extensionBase}options.html#page=reading`, {
      waitUntil: 'domcontentloaded'
    });
    await options.locator('#openPdfReader').waitFor({ state: 'visible' });
    const settingsReader = await waitForNewPage(() =>
      options.locator('#openPdfReader').click());
    await settingsReader.waitForURL(url => url.pathname.endsWith('/pdf-reader.html'), {
      timeout: 20_000
    });
    await settingsReader.waitForLoadState('domcontentloaded');
    await settingsReader.locator('#pdfLocalFileFallback').waitFor({ state: 'visible' });
    check('settings opens the same no-source PDF reader',
      new URL(settingsReader.url()).pathname.endsWith('/pdf-reader.html') &&
      !new URL(settingsReader.url()).searchParams.has('source'));

    const initialRemoteUrl = settingsReader.url();
    await settingsReader.locator('#pdfRemoteUrl').fill('file:///private/paper.pdf');
    await settingsReader.locator('#pdfRemoteUrlOpen').click();
    check('non-HTTP(S) remote input is rejected in place',
      settingsReader.url() === initialRemoteUrl &&
      /必须使用 http:\/\/ 或 https:\/\//u.test(
        await settingsReader.locator('#pdfRemoteUrlStatus').textContent()) &&
      await settingsReader.locator('#pdfRemoteUrl').getAttribute('aria-invalid') === 'true');
    await settingsReader.locator('#pdfRemoteUrl').fill('not a URL');
    await settingsReader.locator('#pdfRemoteUrlOpen').click();
    check('malformed remote input is rejected with an explicit message',
      settingsReader.url() === initialRemoteUrl &&
      /有效的远程 PDF 地址/u.test(
        await settingsReader.locator('#pdfRemoteUrlStatus').textContent()));

    const remoteSource = 'https://example.org/public-paper.pdf#page=3';
    await settingsReader.locator('#pdfRemoteUrl').fill(remoteSource);
    await settingsReader.locator('#pdfRemoteUrlOpen').click();
    await settingsReader.waitForURL(url =>
      url.pathname.endsWith('/pdf-reader.html') &&
      url.searchParams.get('source') === 'https://example.org/public-paper.pdf', {
      timeout: 20_000
    });
    report.remoteNavigation = {
      requested: remoteSource,
      readerUrl: settingsReader.url(),
      source: new URL(settingsReader.url()).searchParams.get('source'),
      loadedRemoteBytes: false,
      note: 'navigation contract only; external HTTP was blocked before document download'
    };
    check('valid HTTPS input navigates to the owned reader with a normalized source',
      report.remoteNavigation.source === 'https://example.org/public-paper.pdf',
      report.remoteNavigation);
    check('no model or MinerU API was contacted', report.providerApiCalls === 0,
      { providerApiCalls: report.providerApiCalls,
        blockedHttpRequests: report.blockedHttpRequests });

    report.status = 'PASS';
  } catch (error) {
    report.error = error?.stack || String(error);
    process.exitCode = 1;
  } finally {
    await context?.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    const resolvedTemporary = path.resolve(temporary);
    if (resolvedTemporary.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(resolvedTemporary).startsWith('brevess-pdf-open-entry-')) {
      fs.rmSync(resolvedTemporary, { recursive: true, force: true });
    }
  }
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length,
    report: path.join(output, 'report.json'), error: report.error || '' })}\n`);
}

await run();
