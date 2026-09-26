import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const output = path.resolve(process.env.SCI_SCENARIO_SETTINGS_OUTPUT ||
  path.join(repositoryRoot, 'output/playwright/scenario-settings'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-scenario-settings-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
fs.mkdirSync(output, { recursive: true });

for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
}
for (const file of fs.readdirSync(root)) {
  if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  }
}

const report = { status: 'FAIL', externalRequests: 0, checks: [], messages: [] };
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge',
    headless: true,
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => {
    report.externalRequests += 1;
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());

  async function open(hash, selector) {
    await page.goto(`chrome-extension://${extensionId}/options.html${hash}`);
    await page.locator(selector).waitFor({ state: 'visible' });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      globalThis.__scenarioSettingsMessages = [];
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message, ...args) => {
        globalThis.__scenarioSettingsMessages.push(structuredClone(message));
        return original(message, ...args);
      };
    });
  }

  async function collectMessages() {
    report.messages.push(...await page.evaluate(() =>
      globalThis.__scenarioSettingsMessages || []));
  }

  async function assertNoOverflow(name, width, height, selector) {
    await page.setViewportSize({ width, height });
    await page.locator(selector).waitFor({ state: 'visible' });
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      duplicateIds: [...document.querySelectorAll('[id]')]
        .map(node => node.id).filter((id, index, ids) => ids.indexOf(id) !== index)
    }));
    assert.ok(metrics.scrollWidth <= metrics.viewport + 1,
      `${name}: ${metrics.scrollWidth}px content in ${metrics.viewport}px viewport`);
    assert.deepEqual(metrics.duplicateIds, []);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false });
  }

  await open('#page=modes', '#analysisModeSettings');
  const scenarioButtons = page.locator('[data-analysis-mode-id]');
  await scenarioButtons.first().waitFor();
  assert.ok(await scenarioButtons.count() >= 2);
  await scenarioButtons.first().focus();
  await scenarioButtons.first().press('ArrowDown');
  assert.equal(await scenarioButtons.nth(1).getAttribute('aria-selected'), 'true');
  report.checks.push('scenario list supports arrow-key selection');

  await page.locator('#duplicateAnalysisMode').click();
  await page.locator('#analysisModeName').fill('验证场景副本');
  await page.locator('#analysisModeDescription').fill('保存、重载和删除验证');
  const copiedScenarioId = await page.locator('#analysisModeId').inputValue();
  assert.match(copiedScenarioId, /^mode_[a-z0-9_]+$/u);
  await page.locator('#saveAnalysisModes').click();
  await page.locator('#analysisModeStatus.success').waitFor();
  await collectMessages();

  await open('#page=modes', '#analysisModeSettings');
  const copiedScenario = page.locator(`[data-analysis-mode-id="${copiedScenarioId}"]`);
  await copiedScenario.waitFor();
  await copiedScenario.click();
  assert.equal(await page.locator('#analysisModeName').inputValue(), '验证场景副本');
  assert.equal(await page.locator('#analysisModeDescription').inputValue(),
    '保存、重载和删除验证');
  report.checks.push('duplicated scenario survives save and full settings reload');

  await page.locator('#deleteAnalysisMode').click();
  await page.locator('#saveAnalysisModes').click();
  await page.locator('#analysisModeStatus.success').waitFor();
  await collectMessages();
  await open('#page=modes', '#analysisModeSettings');
  assert.equal(await page.locator(`[data-analysis-mode-id="${copiedScenarioId}"]`).count(), 0);
  report.checks.push('custom scenario deletion survives reload');

  const builtInId = 'quick_story';
  const builtIn = page.locator(`[data-analysis-mode-id="${builtInId}"]`);
  await builtIn.waitFor();
  await builtIn.click();
  await page.locator('#deleteAnalysisMode').click();
  await page.locator('#saveAnalysisModes').click();
  await page.locator('#analysisModeStatus.success').waitFor();
  await collectMessages();
  await open('#page=modes', '#analysisModeSettings');
  assert.equal(await page.locator(`[data-analysis-mode-id="${builtInId}"]`).count(), 0);
  const restoreRow = page.locator('#deletedBuiltInAnalysisModeList .deleted-built-in-row')
    .filter({ hasText: builtInId });
  await restoreRow.locator('button').click();
  await page.locator('#saveAnalysisModes').click();
  await page.locator('#analysisModeStatus.success').waitFor();
  await collectMessages();
  await open('#page=modes', '#analysisModeSettings');
  await page.locator(`[data-analysis-mode-id="${builtInId}"]`).waitFor();
  report.checks.push('deleted built-in stays deleted across reload and returns only after restore');

  await assertNoOverflow('scenario-390', 390, 844, '#analysisModeSettings');
  await assertNoOverflow('scenario-320', 320, 720, '#analysisModeSettings');
  report.checks.push('scenario editor reflows at 390px and 320px');

  await open('#page=categories', '#categoryWorkspace');
  await page.locator('#duplicateSelectedCategory:not([disabled])').waitFor();
  await page.locator('#duplicateSelectedCategory').click();
  await page.waitForFunction(() =>
    document.querySelector('#categoryInspectorId')?.textContent?.startsWith('custom_copy_'));
  const copiedCategoryId = (await page.locator('#categoryInspectorId').textContent()).trim();
  await page.locator('#categoryClaimMode').selectOption('either');
  await page.locator('#categoryRelationRequired').check();
  await page.locator('#saveCategoryOverride').click();
  await page.waitForFunction(() =>
    document.querySelector('#categoryEditorStatus')?.dataset?.state === 'saved');
  await collectMessages();
  await open(`#page=categories&category=${encodeURIComponent(copiedCategoryId)}`,
    '#categoryWorkspace');
  await page.waitForFunction(categoryId =>
    document.querySelector('#categoryInspectorId')?.textContent === categoryId,
  copiedCategoryId);
  assert.equal(await page.locator('#categoryClaimMode').inputValue(), 'either');
  assert.equal(await page.locator('#categoryRelationRequired').isChecked(), true);
  report.checks.push('full category duplicate and semantic fields survive save and reload');
  await assertNoOverflow('category-320', 320, 720, '#categoryWorkspace');

  await collectMessages();
  const forbidden = report.messages.filter(message =>
    /ANALYZ|HIGHLIGHT_DOCUMENT|CALL_PROVIDER|TEST_PROVIDER|TEST_PROFILE/u
      .test(String(message?.type || '')));
  assert.deepEqual(forbidden, []);
  assert.equal(report.externalRequests, 0);
  assert.deepEqual(pageErrors, []);
  report.checks.push('scenario and category CRUD trigger no provider task or external request');
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-scenario-settings-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status,
  checks: report.checks.length,
  externalRequests: report.externalRequests,
  error: report.error
}));
