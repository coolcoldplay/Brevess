import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const extensionPath = path.resolve(process.env.EXTENSION_PATH ||
  path.join(root, 'dist', 'Brevess-v1.0.1-build7-nature-extended-data-hires'));
const outputDir = path.resolve(process.env.OUTPUT_DIR ||
  path.join(root, 'output', 'playwright', 'settings-onboarding-audit-20260814'));

if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
  throw new Error(`Missing unpacked extension: ${extensionPath}`);
}

fs.mkdirSync(outputDir, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-settings-audit-'));

function diagnostics(page) {
  const result = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
  });
  return result;
}

async function screenshot(page, name, { fullPage = false } = {}) {
  const target = path.join(outputDir, name);
  await page.screenshot({ path: target, fullPage });
  return target;
}

async function measure(page, label) {
  return page.evaluate(currentLabel => {
    const visible = element => Boolean(element && !element.hidden && element.checkVisibility());
    const visiblePages = [...document.querySelectorAll('[data-settings-page]')]
      .filter(visible)
      .map(section => section.id);
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
    const guide = document.querySelector('#onboardingGuide')?.getBoundingClientRect();
    const pageTitle = document.querySelector('#settingsPageTitle');
    return {
      label: currentLabel,
      viewport: { width: innerWidth, height: innerHeight },
      bodyScrollHeight: document.body.scrollHeight,
      topbarHeight: Math.round(topbar?.height || 0),
      guideHeight: Math.round(guide?.height || 0),
      visiblePages,
      visibleSettingsSections: [...document.querySelectorAll('.settings-section')]
        .filter(visible).length,
      topNavigationItems: document.querySelectorAll('[data-settings-nav]').length,
      onboardingActive: document.body.classList.contains('is-onboarding'),
      onboardingStep: document.body.dataset.onboardingStep || '',
      pageTitle: pageTitle?.textContent?.trim() || '',
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
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
  const report = {
    extensionId,
    extensionPath,
    profileDir,
    screenshots: [],
    states: [],
    diagnostics: pageDiagnostics
  };

  await page.goto(`chrome-extension://${extensionId}/options.html#page=categories`, {
    waitUntil: 'domcontentloaded'
  });
  await page.locator('#categoryWorkspace').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);

  async function showSettingsPage(name) {
    await page.evaluate(pageName => {
      onboardingUi.active = false;
      leaveOnboardingLayout();
      activateSettingsPage(pageName, { updateHash: false, animate: false });
      scrollTo(0, 0);
    }, name);
    await page.waitForTimeout(180);
  }

  async function showOnboarding(step) {
    await page.evaluate(stepName => {
      onboardingUi.state = {
        acknowledged: false,
        steps: { storage: 'pending', api: 'pending' },
        sourceTab: null
      };
      onboardingUi.finishPrepared = false;
      onboardingUi.pending = false;
      onboardingUi.step = stepName;
      onboardingUi.active = true;
      renderOnboarding();
      scrollTo(0, 0);
    }, step);
    await page.waitForTimeout(180);
  }

  await showSettingsPage('categories');
  report.screenshots.push(await screenshot(page, '01-settings-categories-1440.png'));
  report.states.push(await measure(page, 'settings-categories-1440'));

  await showOnboarding('storage');
  report.screenshots.push(await screenshot(page, '02-onboarding-storage-1440.png'));
  report.screenshots.push(await screenshot(page, '02-onboarding-storage-full.png', { fullPage: true }));
  report.states.push(await measure(page, 'onboarding-storage-1440'));

  await showOnboarding('api');
  report.screenshots.push(await screenshot(page, '03-onboarding-api-1440.png'));
  report.screenshots.push(await screenshot(page, '03-onboarding-api-full.png', { fullPage: true }));
  report.states.push(await measure(page, 'onboarding-api-1440'));

  await showSettingsPage('models');
  report.screenshots.push(await screenshot(page, '04-settings-models-1440.png'));
  report.screenshots.push(await screenshot(page, '04-settings-models-full.png', { fullPage: true }));
  report.states.push(await measure(page, 'settings-models-1440'));

  await showSettingsPage('data');
  report.screenshots.push(await screenshot(page, '05-settings-data-1440.png'));
  report.states.push(await measure(page, 'settings-data-1440'));

  await showSettingsPage('modes');
  report.screenshots.push(await screenshot(page, '06-settings-modes-1440.png'));
  report.states.push(await measure(page, 'settings-modes-1440'));

  await showSettingsPage('shortcuts');
  report.screenshots.push(await screenshot(page, '07-settings-shortcuts-1440.png'));
  report.states.push(await measure(page, 'settings-shortcuts-1440'));

  await page.setViewportSize({ width: 600, height: 900 });
  await showOnboarding('api');
  report.screenshots.push(await screenshot(page, '08-onboarding-api-600.png'));
  report.states.push(await measure(page, 'onboarding-api-600'));

  await showSettingsPage('models');
  report.screenshots.push(await screenshot(page, '09-settings-models-600.png'));
  report.states.push(await measure(page, 'settings-models-600'));

  fs.writeFileSync(
    path.join(outputDir, 'audit-report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await context?.close();
}
