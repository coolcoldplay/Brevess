import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brevess-local-library-'));
const extensionRoot = path.join(temporaryRoot, 'extension');
const profileRoot = path.join(temporaryRoot, 'profile');
await fs.mkdir(path.join(extensionRoot, 'core'), { recursive: true });

const W1 = `workspace:${'1'.repeat(64)}`;
const W2 = `workspace:${'2'.repeat(64)}`;
const fixture = {
  workspaces: [
    { workspaceId: W1, title: 'Inflammation Atlas', canonicalUrl: 'https://example.org/one',
      updatedAt: '2026-02-01T00:00:00.000Z' },
    { workspaceId: W2, title: 'Repair Atlas', canonicalUrl: 'https://example.org/two',
      updatedAt: '2026-02-02T00:00:00.000Z' }
  ],
  assets: {
    [W1]: [
      { relativePath: 'article/paragraphs.json', revision: 1, content: { paragraphs: [
        { sectionTitle: 'Abstract', text: 'TNF drives browser abstract; TNF-like and tnf recur.' },
        { sectionTitle: 'Methods', text: 'Method browser marker follows TNF treatment.' },
        { sectionTitle: 'Results', text: 'Fulltext browser marker.' }
      ]}},
      { relativePath: 'annotations/literature-note.json', revision: 1, content: {
        valuesByTemplate: { default: { insight: 'Notebook browser marker' } }
      }},
      { relativePath: 'figures/inventory.json', revision: 1, content: {
        figures: [{ figureLabel: 'Figure 1', caption: 'Caption browser marker with TNF.' }]
      }}
    ],
    [W2]: [
      { relativePath: 'article/paragraphs.json', revision: 1, content: { paragraphs: [
        { sectionTitle: 'Results', text: 'TNF appears while xTNF and TNF1 do not count.' }
      ]}}
    ]
  },
  memory: { entries: [{
    abbreviation: 'TNF', fullName: 'tumor necrosis factor', meaningZh: '肿瘤坏死因子',
    supportCount: 2, addedAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    firstImportedAt: '2025-06-01T00:00:00.000Z'
  }, {
    abbreviation: 'IL6', fullName: 'interleukin 6', supportCount: 1,
    addedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z'
  }] }
};

await Promise.all([
  fs.copyFile(path.join(repository, 'core', 'abbreviation-extractor.js'),
    path.join(extensionRoot, 'core', 'abbreviation-extractor.js')),
  fs.copyFile(path.join(repository, 'core', 'local-reading-library.js'),
    path.join(extensionRoot, 'core', 'local-reading-library.js')),
  fs.copyFile(path.join(repository, 'options-local-library.js'),
    path.join(extensionRoot, 'options-local-library.js')),
  fs.copyFile(path.join(repository, 'options-local-library.css'),
    path.join(extensionRoot, 'options-local-library.css'))
]);

await fs.writeFile(path.join(extensionRoot, 'manifest.json'), JSON.stringify({
  manifest_version: 3,
  name: 'Brevess local library fixture',
  version: '1.0.0',
  permissions: ['storage'],
  background: { service_worker: 'background-fixture.js' },
  options_ui: { page: 'options.html', open_in_tab: true }
}, null, 2));

await fs.writeFile(path.join(extensionRoot, 'options.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>本地库验证</title>
<link rel="stylesheet" href="options-local-library.css"><style>
body{font:14px system-ui;margin:24px;color:#17202a}.button,input,select{font:inherit;padding:7px}
#localReadingLibrary{max-width:1100px;margin:auto}</style></head><body>
<section id="localReadingLibrary"></section>
<script src="options-local-library.js"></script></body></html>`);

await fs.writeFile(path.join(extensionRoot, 'background-fixture.js'), `
importScripts('core/abbreviation-extractor.js', 'core/local-reading-library.js');
let fixture = ${JSON.stringify(fixture)};
function library() {
  return SciLLM.buildLocalReadingLibrary({
    workspaces: fixture.workspaces,
    assetsByWorkspace: new Map(Object.entries(fixture.assets)),
    globalMemory: fixture.memory
  });
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOCAL_READING_LIBRARY_QUERY') {
    sendResponse({ success: true, data: SciLLM.queryLocalReadingLibrary(library(), message) });
    return false;
  }
  if (message.type === 'ABBREVIATION_MEMORY_MUTATE') {
    try {
      const changed = SciLLM.mutateGlobalAbbreviationMemory(
        fixture.memory, message.mutation, { now: '2026-06-01T00:00:00.000Z' }
      );
      fixture.memory = changed.memory;
      sendResponse({ success: true, data: changed });
    } catch (error) {
      sendResponse({ success: false, error: { code: error.code, message: error.message } });
    }
    return false;
  }
  if (message.type === 'FIXTURE_MEMORY') {
    sendResponse({ success: true, memory: fixture.memory });
    return false;
  }
  if (message.type === 'FIXTURE_READING_ENTRIES') {
    sendResponse({ success: true, entries: SciLLM.composeArticleAbbreviations({
      paragraphs: [{ paragraphId: 'p1', text: 'signal transducer and activator of transcription 3 (STAT3)' }],
      globalMemory: fixture.memory
    }).entries });
    return false;
  }
  if (message.type === 'FIXTURE_REPEAT_SAVE') {
    fixture.assets[${JSON.stringify(W1)}].push(...fixture.assets[${JSON.stringify(W1)}]);
    sendResponse({ success: true });
    return false;
  }
  if (message.type === 'FIXTURE_DELETE_FIRST') {
    fixture.workspaces = fixture.workspaces.filter(item => item.workspaceId !== ${JSON.stringify(W1)});
    sendResponse({ success: true });
    return false;
  }
});`);

let context;
try {
  const browserCandidates = process.platform === 'win32' ? [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ] : [];
  let executablePath;
  for (const candidate of browserCandidates) {
    try {
      await fs.access(candidate);
      executablePath = candidate;
      break;
    } catch (_) {}
  }
  context = await chromium.launchPersistentContext(profileRoot, {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const externalRequests = [];
  context.on('request', request => {
    if (/^https?:/u.test(request.url())) externalRequests.push(request.url());
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.locator('[data-library-status]').filter({ hasText: '本机共 2 篇' }).waitFor();

  const scope = page.locator('[data-library-scope]');
  const search = page.locator('[data-library-search]');
  for (const [selectedScope, marker] of [
    ['abstract', 'browser abstract'],
    ['method', 'Method browser marker'],
    ['caption', 'Caption browser marker'],
    ['notes', 'Notebook browser marker'],
    ['fulltext', 'Fulltext browser marker']
  ]) {
    await scope.selectOption(selectedScope);
    await search.fill(marker);
    await page.waitForFunction(expected => {
      const cards = [...document.querySelectorAll('.local-library__article')];
      return cards.length === 1 && cards[0].textContent.includes(expected);
    }, marker);
    assert.equal(await page.locator('.local-library__article').count(), 1);
    assert.match(await page.locator('.local-library__hits').textContent(),
      new RegExp(selectedScope === 'method' ? '方法' : selectedScope === 'caption' ? '图注' :
        selectedScope === 'notes' ? '笔记' : selectedScope === 'abstract' ? '摘要' : '全文'));
  }

  await page.locator('[data-library-kind="abbreviations"]').click();
  await search.fill('TNF');
  const termRow = page.locator('tbody tr').filter({ hasText: 'tumor necrosis factor' }).first();
  await termRow.waitFor();
  assert.match(await termRow.textContent(), /2\s*6\s*展开/u);
  await termRow.getByRole('button', { name: '展开' }).click();
  assert.equal(await page.locator('.local-library__details-row:not([hidden]) li').count(), 2);

  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'FIXTURE_REPEAT_SAVE' }));
  await page.getByRole('button', { name: '刷新' }).click();
  await page.locator('tbody tr').filter({ hasText: 'tumor necrosis factor' }).first().waitFor();
  assert.match(await page.locator('tbody tr').filter({ hasText: 'tumor necrosis factor' })
    .first().textContent(), /2\s*6\s*展开/u);

  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'FIXTURE_DELETE_FIRST' }));
  await page.getByRole('button', { name: '刷新' }).click();
  const afterDelete = page.locator('tbody tr').filter({ hasText: 'tumor necrosis factor' }).first();
  await afterDelete.waitFor();
  assert.match(await afterDelete.textContent(), /1\s*1\s*展开/u);

  await search.fill('');
  await page.getByRole('button', { name: '新增缩略词' }).click();
  await page.getByLabel('缩写').fill('STAT3');
  await page.getByLabel('英文全称').fill('signal transducer and activator of transcription 3');
  await page.getByLabel('中文释义（可选）').fill('信号转导及转录激活蛋白 3');
  await page.getByRole('button', { name: '添加' }).click();
  let statRow = page.locator('tbody tr').filter({ hasText: 'STAT3' }).first();
  await statRow.waitFor();
  const createdMemory = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'FIXTURE_MEMORY' }));
  const createdStat = createdMemory.memory.entries.find(item => item.abbreviation === 'STAT3');
  assert.ok(createdStat.entryId);

  await statRow.getByRole('button', { name: '编辑' }).click();
  await page.getByLabel('英文全称').fill(
    'signal transducer and activator of transcription protein 3'
  );
  await page.getByRole('button', { name: '保存修改' }).click();
  statRow = page.locator('tbody tr').filter({ hasText: 'STAT3' }).first();
  await statRow.waitFor();
  assert.match(await statRow.textContent(), /transcription protein 3/u);
  const editedMemory = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'FIXTURE_MEMORY' }));
  const editedStat = editedMemory.memory.entries.find(item => item.abbreviation === 'STAT3');
  assert.equal(editedStat.entryId, createdStat.entryId);
  assert.equal(editedStat.firstImportedAt, createdStat.firstImportedAt);

  await statRow.getByRole('checkbox').uncheck();
  await page.waitForFunction(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'FIXTURE_MEMORY' });
    return response.memory.entries.find(item => item.abbreviation === 'STAT3')
      ?.hiddenFromReading === true;
  });
  statRow = page.locator('tbody tr').filter({ hasText: 'STAT3' }).first();
  await statRow.waitFor();
  assert.equal(await statRow.getByRole('checkbox').isChecked(), false);
  const hiddenReading = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'FIXTURE_READING_ENTRIES' }));
  assert.equal(hiddenReading.entries.some(item => item.abbreviation === 'STAT3'), false);
  await statRow.getByRole('checkbox').check();
  await page.waitForFunction(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'FIXTURE_MEMORY' });
    return response.memory.entries.find(item => item.abbreviation === 'STAT3')
      ?.hiddenFromReading !== true;
  });
  const visibleReading = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'FIXTURE_READING_ENTRIES' }));
  assert.equal(visibleReading.entries.some(item => item.abbreviation === 'STAT3'), true);

  page.once('dialog', dialog => dialog.accept());
  statRow = page.locator('tbody tr').filter({ hasText: 'STAT3' }).first();
  await statRow.getByRole('button', { name: '删除' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('tbody tr')]
    .some(row => row.textContent.includes('STAT3')));
  assert.deepEqual(externalRequests, []);
  console.log('Local reading library temporary-extension verification passed.');
} finally {
  await context?.close();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
