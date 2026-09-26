import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(process.env.SCI_EXTENSION_ROOT ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR ||
  path.join(root, 'output/playwright/note-template-settings'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-note-template-settings-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
fs.mkdirSync(output, { recursive: true });

const report = {
  status: 'FAIL', realApiCalls: 0, externalRequests: 0,
  checks: [], sourceHashes: {}
};
for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
}
for (const file of fs.readdirSync(root)) {
  if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  }
}
for (const file of ['options.js', 'options.html', 'options.css', 'core/reading-tools.js']) {
  report.sourceHashes[file] = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, file))).digest('hex');
}

let context;
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1100 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => {
    report.externalRequests += 1;
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#page=reading`);
  await page.locator('#literatureNoteTemplateList .literature-note-template-row').first().waitFor();

  const helpText = await page.locator('#literatureNoteTemplateSettings').innerText();
  assert.match(helpText, /字段.*AI 提示词/su);
  assert.doesNotMatch(helpText, /字段 ID\s*\|/u);
  report.checks.push('prompt-first editor copy hides ID syntax');

  const firstTemplate = page.locator('.literature-note-template-row').first();
  const originalTemplateId = await firstTemplate.getAttribute('data-literature-template-id');
  const firstField = firstTemplate.locator('[data-literature-note-field-row]').first();
  const originalFieldId = await firstField.getAttribute('data-literature-field-id');
  await firstTemplate.locator('[data-literature-template-name]').fill('基础研究 · 已重命名');
  await firstField.locator('[data-literature-field-label]').fill('研究背景与证据缺口');
  await firstField.locator('[data-literature-field-prompt]').fill(
    '先概括研究背景。\n再指出文章直接支持的证据缺口。'
  );
  await firstField.locator('details').evaluate(element => { element.open = true; });
  await firstField.locator('[data-literature-field-placeholder]').fill('仅记录文章可支持的内容');
  await firstField.locator('[data-literature-field-multiline]').uncheck();
  await firstField.locator('[data-literature-field-required]').check();
  assert.equal(await firstTemplate.getAttribute('data-literature-template-id'), originalTemplateId);
  assert.equal(await firstField.getAttribute('data-literature-field-id'), originalFieldId);
  report.checks.push('template and field rename preserve stable ids');

  await page.locator('#addLiteratureNoteTemplate').click();
  const custom = page.locator('.literature-note-template-row').last();
  await custom.locator('[data-literature-template-name]').fill('验收自定义模板');
  const defaultCustomField = custom.locator('[data-literature-note-field-row]').first();
  await defaultCustomField.locator('[data-literature-field-label]').fill('应删除字段');
  await custom.locator('[data-add-literature-field]').click();
  const addedField = custom.locator('[data-literature-note-field-row]').last();
  await addedField.locator('[data-literature-field-label]').fill('关键机制');
  await addedField.locator('[data-literature-field-prompt]').fill(
    '提取干预、直接观察和结论。\n没有文章证据时保持缺失状态。'
  );
  await addedField.locator('details').evaluate(element => { element.open = true; });
  await addedField.locator('[data-literature-field-placeholder]').fill('干预 → 观察 → 结论');
  const addedFieldId = await addedField.getAttribute('data-literature-field-id');
  await defaultCustomField.locator('[data-delete-literature-field]').click();
  assert.equal(await custom.locator('[data-literature-note-field-row]').count(), 1);
  assert.equal(await custom.locator('[data-delete-literature-field]').isDisabled(), true);
  report.checks.push('field add and delete work while protecting the final field');

  await page.locator('#addLiteratureNoteTemplate').click();
  const disposable = page.locator('.literature-note-template-row').last();
  await disposable.locator('[data-literature-template-name]').fill('待删除模板');
  await disposable.locator('[data-delete-literature-template]').click();
  assert.equal(await page.locator('[data-literature-template-name]').evaluateAll(inputs =>
    inputs.filter(input => input.value === '待删除模板').length), 0);
  report.checks.push('template add and delete work');

  const collected = await page.evaluate(() => collectLiteratureNoteTemplates());
  const renamed = collected.find(template => template.id === originalTemplateId);
  assert.ok(renamed);
  assert.equal(renamed.name, '基础研究 · 已重命名');
  const renamedField = renamed.fields.find(field => field.id === originalFieldId);
  assert.deepEqual(renamedField, {
    id: originalFieldId,
    label: '研究背景与证据缺口',
    prompt: '先概括研究背景。\n再指出文章直接支持的证据缺口。',
    placeholder: '仅记录文章可支持的内容',
    multiline: false,
    required: true
  });
  const customTemplate = collected.find(template => template.name === '验收自定义模板');
  assert.equal(customTemplate.fields[0].id, addedFieldId);
  assert.equal(customTemplate.fields[0].label, '关键机制');
  assert.match(customTemplate.fields[0].prompt, /没有文章证据时保持缺失状态/u);
  report.checks.push('collector retains id label prompt placeholder and flags');

  await page.evaluate(async templates => {
    const response = await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PREFERENCES', preferences: { literatureNoteTemplates: templates }
    });
    if (!response?.success) throw new Error(response?.error?.code || 'SAVE_FAILED');
  }, collected);
  await page.reload();
  await page.locator('#literatureNoteTemplateList .literature-note-template-row').first().waitFor();
  const reloaded = await page.evaluate(() => collectLiteratureNoteTemplates());
  const reloadedRenamed = reloaded.find(template => template.id === originalTemplateId);
  const reloadedField = reloadedRenamed.fields.find(field => field.id === originalFieldId);
  assert.equal(reloadedRenamed.name, '基础研究 · 已重命名');
  assert.equal(reloadedField.label, '研究背景与证据缺口');
  assert.equal(reloadedField.prompt,
    '先概括研究背景。\n再指出文章直接支持的证据缺口。');
  assert.equal(reloadedField.placeholder, '仅记录文章可支持的内容');
  assert.equal(reloadedField.multiline, false);
  assert.equal(reloadedField.required, true);
  assert.equal(reloaded.find(template => template.name === '验收自定义模板')
    .fields[0].id, addedFieldId);
  report.checks.push('saved templates and field properties survive extension reload');

  await page.evaluate(template => renderLiteratureNoteTemplates([template]), reloadedRenamed);
  assert.equal(await page.locator('[data-delete-literature-template]').isDisabled(), true);
  assert.equal(await page.locator('[data-delete-literature-field]').first().isDisabled(),
    reloadedRenamed.fields.length === 1);
  report.checks.push('last-template deletion is blocked to avoid default refill');

  await page.reload();
  await page.locator('#literatureNoteTemplateList .literature-note-template-row').first().waitFor();
  await page.locator('#literatureNoteTemplateSettings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'note-template-settings.png'), fullPage: true });
  assert.equal(report.externalRequests, 0);
  report.checks.push('actual extension completed with zero external requests');
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-note-template-settings-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({
  status: report.status, checks: report.checks.length,
  externalRequests: report.externalRequests, error: report.error
}));
