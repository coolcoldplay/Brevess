import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR || path.join(root, 'tmp/figure-settings-extension'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-settings-acceptance-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
fs.mkdirSync(output, { recursive: true });
const report = { realApiCalls: 0, checks: [], sourceHashes: {}, status: 'FAIL' };
for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
}
for (const file of fs.readdirSync(root)) {
  if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  }
}
for (const file of ['options.js', 'options.html', 'core/llm-task-catalog.js', 'core/task-profile-router.js']) {
  report.sourceHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
}
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce', viewport: { width: 1440, height: 1100 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#page=models`);
  await options.evaluate(async () => {
    for (const [id, name, model] of [
      ['profile_settings_text', 'Text acceptance', 'deepseek-v4-flash'],
      ['profile_settings_vision', 'Vision acceptance', 'deepseek-v4-flash-vision-exp']
    ]) {
      const result = await chrome.runtime.sendMessage({ type: 'LLM_SAVE_PROFILE',
        profile: { id, name, providerId: 'deepseek', config: { model, apiKey: 'settings-fixture-not-a-real-key', reasoningEnabled: false } } });
      if (!result.success) throw new Error('PROFILE_SETUP_FAILED');
    }
    const routed = await chrome.runtime.sendMessage({ type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_settings_vision', taskPolicies: {} });
    if (!routed.success) throw new Error('ROUTING_SETUP_FAILED');
  });
  await options.reload();
  await options.waitForFunction(() =>
    document.querySelectorAll('[data-task-policy-id]').length === 15);
  await options.locator('#advancedTaskRouting').evaluate(details => { details.open = true; });
  const taskIds = ['figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup'];
  for (const id of taskIds) {
    const select = options.locator(`[data-task-policy-profile="${id}"]`);
    await select.waitFor();
    assert.equal(await select.locator('option[value="profile_settings_text"]').isDisabled(), false);
    await select.selectOption('profile_settings_text');
    assert.match(await options.locator(`[data-task-policy-status="${id}"]`).innerText(), /支持此输入|Input supported/iu);
    report.checks.push(`${id}: text model selectable and input-supported`);
  }
  await options.locator('#saveSettings').click();
  await options.waitForFunction(ids => ids.every(id => state?.settings?.taskPolicies?.[id]?.profileId === 'profile_settings_text'), taskIds);
  await options.reload();
  await options.waitForFunction(() =>
    document.querySelectorAll('[data-task-policy-id]').length === 15);
  await options.locator('#advancedTaskRouting').evaluate(details => { details.open = true; });
  for (const id of taskIds) {
    const select = options.locator(`[data-task-policy-profile="${id}"]`);
    await select.waitFor();
    assert.equal(await select.inputValue(), 'profile_settings_text');
    assert.equal(await select.locator('option[value="profile_settings_text"]').isDisabled(), false);
    report.checks.push(`${id}: saved selection survives reload`);
  }
  await options.locator('[data-task-policy-id="figure_walkthrough"]').scrollIntoViewIfNeeded();
  await options.screenshot({ path: path.join(output, 'figure-model-settings.png'), fullPage: true });
  report.status = 'PASS';
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('brevess-settings-acceptance-')) fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error }));
