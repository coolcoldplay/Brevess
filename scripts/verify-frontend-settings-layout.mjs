import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const output = path.resolve(process.env.SCI_FRONTEND_OUTPUT_DIR ||
  path.join(repositoryRoot, 'output/playwright/frontend-fd1-20260906/layout'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-frontend-settings-'));
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

const report = { status: 'FAIL', externalRequests: 0, checks: [], views: [] };
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => {
    report.externalRequests += 1;
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const extensionId = new URL(worker.url()).host;

  async function snapshot(name, width, height, hash, target) {
    await page.setViewportSize({ width, height });
    await page.goto(`chrome-extension://${extensionId}/options.html#page=${hash}`);
    await page.locator(target).waitFor({ state: 'visible' });
    if (hash === 'models') {
      await page.waitForFunction(() =>
        document.querySelectorAll('[data-task-policy-id]').length === 16);
    }
    if (hash === 'reading') {
      await page.locator('.literature-note-template-row').first().waitFor();
    }
    await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      duplicateIds: [...document.querySelectorAll('[id]')].map(node => node.id)
        .filter((id, index, ids) => ids.indexOf(id) !== index),
      connectionActionTop: document.querySelector('#providerConnectionActions')
        ?.getBoundingClientRect().top ?? null,
      taskRows: document.querySelectorAll('[data-task-policy-id]').length,
      commonRows: document.querySelectorAll('#llmTaskPolicyTableBody [data-task-policy-id]').length,
      advancedRows: document.querySelectorAll('#llmAdvancedTaskPolicyTableBody [data-task-policy-id]').length,
      advancedClosed: document.querySelector('#advancedTaskRouting')?.open === false,
      templateRows: document.querySelectorAll('.literature-note-template-row').length,
      visibleTemplateRows: [...document.querySelectorAll('.literature-note-template-row')]
        .filter(node => !node.hidden).length,
      templateNavItems: document.querySelectorAll('[data-literature-template-target]').length,
      missingGlyphs: [...document.querySelectorAll('i.ph')].filter(node => {
        const content = getComputedStyle(node, '::before').content;
        return !content || content === 'none' || content === 'normal' || content === '""';
      }).map(node => node.className)
    }));
    const screenshot = path.join(output, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    report.views.push({ name, screenshot, ...metrics });
    return metrics;
  }

  const modelDesktop = await snapshot('01-model-1440', 1440, 900, 'models', '#providerSettings');
  assert.equal(modelDesktop.horizontalOverflow, false);
  assert.ok(modelDesktop.connectionActionTop <= 1350, `connection actions top: ${modelDesktop.connectionActionTop}`);
  assert.equal(modelDesktop.taskRows, 16);
  assert.equal(modelDesktop.commonRows, 6);
  assert.equal(modelDesktop.advancedRows, 10);
  assert.equal(modelDesktop.advancedClosed, true);
  assert.equal(await page.locator('#llmTaskPolicyTableBody [data-task-policy-id="semantic_find"]').count(), 1);
  report.checks.push('desktop connection-first layout and all 16 tasks including semantic find');

  const modelNarrow = await snapshot('02-model-390', 390, 844, 'models', '#providerSettings');
  assert.equal(modelNarrow.horizontalOverflow, false);
  assert.equal(modelNarrow.duplicateIds.length, 0);
  report.checks.push('390px model settings reflow without page overflow');

  const readingDesktop = await snapshot('03-reading-1440', 1440, 900, 'reading', '#readingSettings');
  assert.equal(readingDesktop.visibleTemplateRows, 1);
  assert.equal(readingDesktop.templateNavItems, readingDesktop.templateRows);
  report.checks.push('desktop reading navigation shows one template editor');

  const readingNarrow = await snapshot('04-reading-390', 390, 844, 'reading', '#readingSettings');
  assert.equal(readingNarrow.horizontalOverflow, false);
  assert.equal(readingNarrow.visibleTemplateRows, 1);
  assert.equal(readingNarrow.duplicateIds.length, 0);
  assert.deepEqual(readingNarrow.missingGlyphs, []);
  assert.deepEqual(errors, []);
  assert.equal(report.externalRequests, 0);
  report.checks.push('390px reading layout, glyphs, and console are clean');
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-frontend-settings-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status, checks: report.checks.length, views: report.views.length,
  externalRequests: report.externalRequests, error: report.error
}));
