const { chromium } = require('playwright');
const path = require('path');

const prototypeUrl = 'http://127.0.0.1:4173/prototypes/native-side-panel-preview/';
const outputDir = path.resolve(__dirname, '..', 'prototypes', 'native-side-panel-preview');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 2048, height: 1160 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(prototypeUrl, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outputDir, 'prototype-active-2048x1160.png'), fullPage: true });

  const initialWidth = await page.locator('#sidePanel').evaluate(element => element.getBoundingClientRect().width);

  await page.locator('[data-target="navigation"]').click();
  await page.locator('#summaryToggle').click();
  await page.locator('[data-jump="mechanisms"]').click();
  await page.waitForTimeout(450);
  const jumpFocused = await page.locator('#mechanisms').evaluate(element => element.classList.contains('source-focus'));
  const summariesVisible = await page.locator('#outlineTree').getAttribute('data-summary');
  await page.screenshot({ path: path.join(outputDir, 'prototype-navigation-2048x1160.png'), fullPage: true });

  await page.locator('[data-target="highlights"]').click();
  await page.locator('#editManual').click();
  await page.locator('#saveAnnotation').click();
  const annotationSaved = await page.locator('#annotationSaved').evaluate(element => element.classList.contains('visible'));

  const resizeBox = await page.locator('#resizeHandle').boundingBox();
  if (!resizeBox) throw new Error('Resize handle is not visible.');
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + 220);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x - 110, resizeBox.y + 220, { steps: 8 });
  await page.mouse.up();
  const resizedWidth = await page.locator('#sidePanel').evaluate(element => element.getBoundingClientRect().width);

  await page.locator('#closePanel').click();
  const closed = await page.locator('#sidePanel').evaluate(element => element.hidden);
  await page.locator('#extensionAction').click();
  const reopened = await page.locator('#sidePanel').evaluate(element => !element.hidden && !element.classList.contains('inactive'));

  await page.locator('[data-target="figures"]').click();
  await page.screenshot({ path: path.join(outputDir, 'prototype-figures-resized-2048x1160.png'), fullPage: true });

  const comparisonPage = await browser.newPage({ viewport: { width: 2048, height: 1160 }, deviceScaleFactor: 1 });
  await comparisonPage.goto('http://127.0.0.1:4173/prototypes/native-side-panel-preview/qa-comparison.html', { waitUntil: 'networkidle' });
  await comparisonPage.screenshot({ path: path.join(outputDir, 'qa-comparison.png'), fullPage: true });
  await comparisonPage.close();

  const results = {
    prototypeUrl,
    initialWidth,
    resizedWidth,
    summariesVisible,
    jumpFocused,
    annotationSaved,
    closed,
    reopened,
    consoleErrors,
    pageErrors,
  };

  const checksPassed =
    summariesVisible === 'visible' &&
    jumpFocused &&
    annotationSaved &&
    resizedWidth >= initialWidth + 80 &&
    closed &&
    reopened &&
    consoleErrors.length === 0 &&
    pageErrors.length === 0;

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
  if (!checksPassed) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
