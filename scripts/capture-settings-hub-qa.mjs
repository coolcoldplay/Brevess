import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const extensionPath = path.resolve(process.env.EXTENSION_PATH ||
  path.join(root, 'dist', 'Brevess-v1.0.1-settings-hub-d'));
const outputDir = path.resolve(process.env.OUTPUT_DIR ||
  path.join(root, 'output', 'playwright', 'settings-hub-qa-20260814'));
if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
  throw new Error(`Missing unpacked extension: ${extensionPath}`);
}
fs.mkdirSync(outputDir, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-settings-hub-'));

function diagnostics(page) {
  const value = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', error => value.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') value.consoleErrors.push(message.text());
  });
  return value;
}

async function capture(page, name) {
  const target = path.join(outputDir, name);
  await page.screenshot({ path: target, fullPage: false });
  return target;
}

async function metrics(page, label) {
  return page.evaluate(currentLabel => {
    const visible = element => Boolean(element && !element.hidden && element.checkVisibility());
    return {
      label: currentLabel,
      viewport: { width: innerWidth, height: innerHeight },
      activePage: document.body.dataset.activeSettingsPage || '',
      visiblePages: [...document.querySelectorAll('[data-settings-page]')]
        .filter(visible).map(element => element.id),
      sidebarVisible: visible(document.querySelector('.settings-sidebar')),
      mobileNavVisible: visible(document.querySelector('.settings-mobile-nav')),
      focusBarVisible: visible(document.querySelector('#setupFocusBar')),
      overviewVisible: visible(document.querySelector('#settingsOverview')),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      bodyHeight: document.body.scrollHeight,
      duplicateIds: [...document.querySelectorAll('[id]')]
        .map(element => element.id)
        .filter((id, index, ids) => ids.indexOf(id) !== index),
      desktopNavOrder: [...document.querySelectorAll('.settings-sidebar [data-settings-nav]')]
        .map(element => element.dataset.settingsNav),
      mobileNavOrder: [...document.querySelectorAll('#settingsMobilePage option')]
        .map(element => element.value),
      readingChildren: [...document.querySelectorAll('#readingSettingsBody > .settings-section')]
        .map(element => element.id),
      storageChildren: [...document.querySelectorAll('#storageSettingsBody > .settings-section')]
        .map(element => element.id)
    };
  }, label);
}

let context;
try {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const pageDiagnostics = diagnostics(page);
  const report = { extensionId, extensionPath, screenshots: [], states: [], diagnostics: pageDiagnostics };

  await page.goto(`chrome-extension://${extensionId}/options.html#page=overview`, {
    waitUntil: 'domcontentloaded'
  });
  await page.locator('#settingsOverview').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  report.screenshots.push(await capture(page, '01-overview-1440.png'));
  report.states.push(await metrics(page, 'overview-1440'));

  await page.locator('#overviewConfigureApi').click();
  await page.locator('#providerSettings').waitFor({ state: 'visible' });
  await page.waitForTimeout(260);
  report.screenshots.push(await capture(page, '02-focused-model-1440.png'));
  report.states.push(await metrics(page, 'focused-model-1440'));

  await page.locator('#onboardingBack').click();
  await page.locator('#settingsOverview').waitFor({ state: 'visible' });
  await page.locator('#overviewConfigureStorage').click();
  await page.locator('#localStorageSettings').waitFor({ state: 'visible' });
  await page.waitForTimeout(260);
  report.screenshots.push(await capture(page, '03-focused-storage-1440.png'));
  report.states.push(await metrics(page, 'focused-storage-1440'));

  await page.evaluate(() => {
    leaveOnboardingLayout();
    activateSettingsPage('storage', { updateHash: false, animate: false });
  });
  await page.locator('#localStorageSettings').waitFor({ state: 'visible' });
  await page.locator('#figureOriginalSettings').waitFor({ state: 'visible' });
  await page.waitForTimeout(260);
  report.screenshots.push(await capture(page, '04-storage-persistence-1440.png'));
  report.states.push(await metrics(page, 'storage-persistence-1440'));

  await page.locator('[data-settings-nav="reading"]').first().click();
  await page.locator('#readingSettings').waitFor({ state: 'visible' });
  await page.waitForTimeout(260);
  report.screenshots.push(await capture(page, '05-reading-tools-1440.png'));
  report.states.push(await metrics(page, 'reading-tools-1440'));

  await page.setViewportSize({ width: 600, height: 900 });
  await page.locator('#settingsMobilePage').selectOption('overview');
  await page.locator('#settingsOverview').waitFor({ state: 'visible' });
  await page.waitForTimeout(260);
  report.screenshots.push(await capture(page, '06-overview-600.png'));
  report.states.push(await metrics(page, 'overview-600'));

  await page.locator('#settingsMobilePage').selectOption('reading');
  await page.locator('#readingSettings').waitFor({ state: 'visible' });
  await page.waitForTimeout(260);
  report.screenshots.push(await capture(page, '07-reading-tools-600.png'));
  report.states.push(await metrics(page, 'reading-tools-600'));

  const expectedReading = [
    'pdfMineruSettings', 'articleChatPromptSettings', 'literatureNoteTemplateSettings',
    'selectionLlmActionSettings', 'panelFollowupSettings'
  ];
  const expectedStorage = ['directorySyncSettings', 'figureOriginalSettings'];
  report.passed = report.diagnostics.pageErrors.length === 0 &&
    report.diagnostics.consoleErrors.length === 0 &&
    report.states.every(state => !state.horizontalOverflow && state.duplicateIds.length === 0) &&
    report.states.every(state =>
      state.desktopNavOrder.indexOf('storage') < state.desktopNavOrder.indexOf('models') &&
      state.mobileNavOrder.indexOf('storage') < state.mobileNavOrder.indexOf('models')) &&
    report.states.some(state => state.sidebarVisible) &&
    report.states.some(state => state.mobileNavVisible) &&
    report.states.some(state => state.focusBarVisible) &&
    expectedReading.every(id => report.states.at(-1).readingChildren.includes(id)) &&
    expectedStorage.every(id => report.states.some(state => state.storageChildren.includes(id))) &&
    report.states.at(-1).readingChildren.every(id => id !== 'figureOriginalSettings');

  fs.writeFileSync(path.join(outputDir, 'settings-hub-report.json'),
    JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  await context?.close();
}
