import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const extensionRoot = path.resolve(
  process.env.SCI_EXTENSION_ROOT || path.resolve(import.meta.dirname, '..')
);
const outputDir = path.resolve(
  process.env.SCI_QA_OUTPUT_DIR ||
  path.join(extensionRoot, 'output', 'playwright', 'manual-figure-import')
);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-manual-figure-'));
fs.mkdirSync(outputDir, { recursive: true });

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 420, height: 900 },
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`
    ]
  });
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() =>
    Boolean(document.getElementById('supplementalFigureImportDialog'))
  );
  await page.evaluate(() => {
    const dialog = document.getElementById('supplementalFigureImportDialog');
    if (typeof resetSupplementalFigureImportForm === 'function') {
      resetSupplementalFigureImportForm();
    }
    const pdfPane = document.querySelector('[data-supplemental-source-pane="pdf"]');
    const manualPane = document.querySelector('[data-supplemental-source-pane="manual"]');
    const manualMode = document.querySelector(
      'input[name="supplementalFigureSourceMode"][value="manual"]'
    );
    if (pdfPane) pdfPane.hidden = true;
    if (manualPane) manualPane.hidden = false;
    if (manualMode) manualMode.checked = true;
    if (dialog && !dialog.open) dialog.showModal();
  });
  await page.locator('[data-supplemental-source-pane="manual"]')
    .waitFor({ state: 'visible' });
  await page.locator('#supplementalFigureKind').selectOption('main');
  await page.locator('#supplementalFigureKind').dispatchEvent('change');
  await page.locator('#supplementalFigureLabel').fill('Figure 3');
  await page.locator('#supplementalFigureSourcePage').fill('8');
  await page.locator('#supplementalFigureImageCaption').fill(
    'Figure 3. (A) Experimental design. (B) Quantification and validation.'
  );
  await page.screenshot({
    path: path.join(outputDir, 'manual-main-figure-420x900.png'),
    fullPage: false
  });
  const measurements = await page.evaluate(() => {
    const dialog = document.getElementById('supplementalFigureImportDialog');
    const pane = document.querySelector('[data-supplemental-source-pane="manual"]');
    const footer = document.querySelector('.supplemental-figure-import-footer');
    const dialogRect = dialog?.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    const paneStyle = pane ? getComputedStyle(pane) : null;
    return {
      kind: document.getElementById('supplementalFigureKind')?.value || '',
      label: document.getElementById('supplementalFigureLabel')?.value || '',
      page: document.getElementById('supplementalFigureSourcePage')?.value || '',
      labelPlaceholder:
        document.getElementById('supplementalFigureLabel')?.placeholder || '',
      dialogOpen: dialog?.open === true,
      paneVisible: Boolean(paneStyle && paneStyle.display !== 'none'),
      footerVisible: Boolean(footerRect && footerRect.top >= 0 && footerRect.bottom <= innerHeight),
      dialogFitsViewport: Boolean(dialogRect && dialogRect.left >= 0 &&
        dialogRect.right <= innerWidth && dialogRect.top >= 0 &&
        dialogRect.bottom <= innerHeight),
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  const result = {
    pass: Boolean(
      measurements.dialogOpen && measurements.paneVisible &&
      measurements.footerVisible && measurements.dialogFitsViewport &&
      !measurements.horizontalOverflow && !pageErrors.length &&
      measurements.kind === 'main' && measurements.label === 'Figure 3' &&
      measurements.page === '8' && measurements.labelPlaceholder.includes('Figure 3')
    ),
    pageErrors,
    measurements
  };
  fs.writeFileSync(
    path.join(outputDir, 'manual-figure-import-qa.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
} finally {
  await context?.close().catch(() => undefined);
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
