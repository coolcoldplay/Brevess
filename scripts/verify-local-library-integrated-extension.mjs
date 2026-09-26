// Real-extension integration acceptance for the settings local library.
// It uses a disposable browser profile, production background RPC/storage, and
// blocks every HTTP(S) request. No provider or publisher endpoint is contacted.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.join(scriptDirectory, '..'));
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR ||
  path.join(root, 'output/playwright/local-library-integrated'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-local-library-integrated-'));
const extension = path.join(temporary, 'extension');
const profile = path.join(temporary, 'profile');
const report = {
  scenario: 'real options.html + production background RPC + persistent browser profile',
  provider: 'none',
  realApiCalls: 0,
  blockedNetworkRequests: [],
  checks: [],
  screenshots: [],
  sourceHashes: {},
  storage: {
    profile: 'disposable temporary profile (removed after the run)',
    indexedDb: {
      database: 'sci-logic-highlighter-user-data',
      version: 4,
      stores: ['workspaces', 'workspaceAssets', 'workspaceTurns', 'workspaceTombstones']
    },
    abbreviationMemory: {
      area: 'chrome.storage.local',
      key: 'sciGlobalAbbreviationMemoryV1'
    },
    seedRpc: ['ARTICLE_WORKSPACE_ENSURE', 'ARTICLE_WORKSPACE_SAVE_ASSET',
      'ABBREVIATION_MEMORY_MERGE'],
    uiRpc: ['LOCAL_READING_LIBRARY_QUERY', 'ABBREVIATION_MEMORY_MUTATE']
  },
  fixture: null,
  launches: [],
  status: 'FAIL'
};

let context;

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function check(name, value, details = undefined) {
  assert.ok(value, details === undefined ? name : `${name}: ${JSON.stringify(details)}`);
  report.checks.push(details === undefined ? { name, pass: true } : { name, pass: true, details });
  process.stdout.write(`PASS ${name}\n`);
}

function sourceHash(relativePath) {
  return sha(fs.readFileSync(path.join(root, relativePath)));
}

function prepareExtension() {
  fs.mkdirSync(extension, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
  }
  for (const relativePath of [
    'manifest.json', 'background.js', 'options.html', 'options-local-library.js',
    'core/article-workspace-store.js', 'core/local-reading-library.js',
    'core/abbreviation-extractor.js', 'core/user-data-database.js'
  ]) report.sourceHashes[relativePath] = sourceHash(relativePath);
}

function workspaceFixture(index, title, canonicalUrl, assets) {
  const digest = sha(canonicalUrl);
  const contentHash = sha(JSON.stringify(assets));
  return {
    workspace: {
      schemaVersion: 1,
      workspaceId: `workspace:${digest}`,
      canonicalUrl,
      aliases: [],
      title,
      directoryName: `${title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 80)}--${digest.slice(0, 16)}`,
      revision: contentHash,
      contentHash,
      workspaceGeneration: 1
    },
    assets: Object.entries(assets).map(([relativePath, content]) => ({ relativePath, content })),
    fixtureIndex: index
  };
}

const fixtures = [
  workspaceFixture(1, 'Inflammation Atlas', 'https://example.org/qa/inflammation-atlas', {
    'article/paragraphs.json': {
      schemaVersion: 1,
      paragraphs: [
        {
          paragraphId: 'inflammation-abstract',
          sectionKind: 'abstract',
          sectionTitle: 'Abstract',
          text: 'abstract-only-marker. TNF drives inflammation; TNF-like and tnf recur.'
        },
        {
          paragraphId: 'inflammation-methods',
          sectionKind: 'methods',
          sectionTitle: 'Materials and Methods',
          text: 'method-only-marker was quantified after TNF treatment.'
        },
        {
          paragraphId: 'inflammation-results',
          sectionKind: 'results',
          sectionTitle: 'Results',
          text: 'fulltext-only-marker identifies the result passage.'
        }
      ]
    },
    'annotations/literature-note.json': {
      schemaVersion: 1,
      valuesByTemplate: { summary: 'notes-only-marker records the microglial interpretation.' }
    },
    'figures/inventory.json': {
      schemaVersion: 1,
      figures: [{ figureId: 'fig-1', figureLabel: 'Figure 1',
        caption: 'caption-only-marker shows TNF in the legend.' }]
    }
  }),
  workspaceFixture(2, 'Repair Atlas', 'https://example.org/qa/repair-atlas', {
    'article/paragraphs.json': {
      schemaVersion: 1,
      paragraphs: [{
        paragraphId: 'repair-results',
        sectionKind: 'results',
        sectionTitle: 'Results',
        text: 'repair-result-marker: TNF appears while xTNF and TNF1 do not count.'
      }]
    }
  })
];

report.fixture = {
  workspaces: fixtures.map(item => ({
    workspaceId: item.workspace.workspaceId,
    title: item.workspace.title,
    canonicalUrl: item.workspace.canonicalUrl,
    assets: item.assets.map(asset => asset.relativePath)
  })),
  expectedTnfOccurrences: {
    total: 6,
    byArticle: { 'Inflammation Atlas': 5, 'Repair Atlas': 1 },
    boundaryNegatives: ['xTNF', 'TNF1']
  },
  searchMarkers: {
    title: 'Inflammation Atlas', notes: 'notes-only-marker',
    fulltext: 'fulltext-only-marker', abstract: 'abstract-only-marker',
    method: 'method-only-marker', caption: 'caption-only-marker'
  }
};

async function launch(label) {
  const launched = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: true,
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1100 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await launched.route(/^https?:\/\//u, route => {
    const url = route.request().url();
    report.blockedNetworkRequests.push(url);
    if (/api\.|chat\/completions|\/responses(?:\?|$)/iu.test(url)) report.realApiCalls += 1;
    return route.abort('blockedbyclient');
  });
  const worker = launched.serviceWorkers()[0] || await launched.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  report.launches.push({ label, extensionId, serviceWorker: worker.url() });
  return { context: launched, worker, extensionId };
}

async function rpc(page, message) {
  const response = await page.evaluate(messageValue =>
    chrome.runtime.sendMessage(messageValue), message);
  assert.equal(response?.success, true,
    `RPC ${message.type} failed: ${JSON.stringify(response?.error || response)}`);
  return response.data;
}

async function seedProductionStores(page) {
  for (const item of fixtures) {
    await rpc(page, { type: 'ARTICLE_WORKSPACE_ENSURE', workspace: item.workspace });
    for (const asset of item.assets) {
      await rpc(page, {
        type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
        workspaceId: item.workspace.workspaceId,
        workspaceGeneration: 1,
        relativePath: asset.relativePath,
        content: asset.content
      });
    }
  }
  // Saving an identical path again must replace that asset revision, not create
  // another logical document/source occurrence.
  const repeated = fixtures[0].assets.find(asset =>
    asset.relativePath === 'article/paragraphs.json');
  await rpc(page, {
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: fixtures[0].workspace.workspaceId,
    workspaceGeneration: 1,
    relativePath: repeated.relativePath,
    content: repeated.content
  });
  await rpc(page, {
    type: 'ABBREVIATION_MEMORY_MERGE',
    incrementSupport: false,
    entries: [
      { abbreviation: 'TNF', fullName: 'tumor necrosis factor', meaningZh: '肿瘤坏死因子' },
      { abbreviation: 'IL6', fullName: 'interleukin 6', meaningZh: '白细胞介素 6' }
    ]
  });
  const first = (await rpc(page, { type: 'ABBREVIATION_MEMORY_GET' })).memory;
  const firstTnf = first.entries.find(item => item.abbreviation === 'TNF');
  await rpc(page, {
    type: 'ABBREVIATION_MEMORY_MERGE',
    incrementSupport: false,
    entries: [{ abbreviation: 'TNF', fullName: 'tumor necrosis factor',
      meaningZh: '肿瘤坏死因子' }]
  });
  const repeatedMemory = (await rpc(page, { type: 'ABBREVIATION_MEMORY_GET' })).memory;
  const repeatedTnf = repeatedMemory.entries.find(item => item.entryId === firstTnf.entryId);
  check('production abbreviation import records a real and stable firstImportedAt',
    Boolean(firstTnf.firstImportedAt) && firstTnf.firstImportedAt === repeatedTnf.firstImportedAt,
    { entryId: firstTnf.entryId, firstImportedAt: firstTnf.firstImportedAt });
}

async function openLocalLibrary(extensionId, pageErrors) {
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/options.html#page=data`, {
    waitUntil: 'domcontentloaded'
  });
  await page.locator('#localReadingLibrary[data-library-mounted="true"]').waitFor();
  await page.locator('[data-settings-page="data"]:not([hidden])').waitFor();
  await page.locator('[data-library-status]').filter({ hasText: '本机共' }).waitFor();
  return page;
}

async function setSearch(page, scope, query) {
  await page.locator('[data-library-scope]').selectOption(scope);
  const scopeLabel = { all: '全部范围', title: '标题', notes: '笔记', fulltext: '全文', abstract: '摘要', method: '方法', caption: '图注' }[scope];
  const scopeSummary = await page.locator('[data-library-scope-summary]').textContent();
  check(`LIB-010 scope summary immediately matches ${scope}`, scopeSummary.includes(`当前范围：${scopeLabel}`), scopeSummary);

  await page.locator('[data-library-search]').fill(query);
  await page.waitForTimeout(260);
  await page.locator('[data-library-status]').filter({ hasNotText: '正在读取' }).waitFor();
  await page.waitForTimeout(50);
  return page.locator('.local-library__article').evaluateAll(cards => cards.map(card => ({
    title: card.querySelector('h4')?.textContent?.trim() || '',
    hits: card.querySelector('.local-library__hits')?.textContent?.trim() || '',
    text: card.textContent?.replace(/\s+/gu, ' ').trim() || ''
  })));
}

async function verifySearchScopes(page) {
  for (const [scope, marker] of Object.entries(report.fixture.searchMarkers)) {
    const cards = await setSearch(page, scope, marker);
    check(`real options local library searches the ${scope} source only`,
      cards.length === 1 && cards[0].title === 'Inflammation Atlas' &&
        cards[0].hits.includes(scope === 'fulltext' ? '全文' : ({
          title: '标题', notes: '笔记', abstract: '摘要', method: '方法', caption: '图注'
        })[scope]), cards);
  }
  const missingCoverage = await setSearch(page, 'method', 'no-such-method-marker');
  const status = await page.locator('[data-library-status]').textContent();
  check('method coverage states that only one of two saved articles is searchable',
    missingCoverage.length === 0 && /方法可检索覆盖\s*1\s*\/\s*2\s*篇/u.test(status) &&
      status.includes('未保存该部分'), { status });
}

function abbreviationRow(page, abbreviation) {
  return page.locator('.local-library__table tbody > tr:not(.local-library__details-row)')
    .filter({ has: page.locator('.local-library__abbr', { hasText: abbreviation }) });
}

async function verifyOccurrenceStats(page) {
  await page.locator('[data-library-search]').fill('');
  await page.waitForTimeout(260);
  await page.locator('[data-library-kind="abbreviations"]').click();
  await page.locator('[data-library-status]').filter({ hasText: '本机共 2 篇' }).waitFor();
  const row = abbreviationRow(page, 'TNF');
  await row.waitFor();
  const cells = await row.locator('td').allTextContents();
  check('production library reports distinct TNF documents and boundary-safe total count',
    cells[4]?.trim() === '2' && cells[5]?.trim() === '6', { cells });
  await row.getByRole('button', { name: /查看出现文献|展开/u }).click();
  const detailRow = row.locator('xpath=following-sibling::tr[1]');
  await detailRow.locator('li').first().waitFor();
  const details = (await detailRow.locator('li').allTextContents()).map(value => value.trim()).sort();
  check('TNF occurrence details retain exact per-article counts after duplicate asset save',
    details.length === 2 && details.some(value => /Inflammation Atlas：5 次/u.test(value)) &&
      details.some(value => /Repair Atlas：1 次/u.test(value)), { details });
  const screenshotPath = path.join(output, 'global-abbreviations-table.png');
  await page.locator('#localReadingLibrary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshotPath, fullPage: false });
  report.screenshots.push(path.relative(root, screenshotPath).replaceAll('\\', '/'));
}

async function addAbbreviation(page, abbreviation, fullName, meaningZh) {
  await page.locator('[data-library-add]').click();
  const editor = page.locator('[data-library-editor]');
  await editor.locator('input[name="abbreviation"]').fill(abbreviation);
  await editor.locator('input[name="fullName"]').fill(fullName);
  await editor.locator('input[name="meaningZh"]').fill(meaningZh);
  await editor.getByRole('button', { name: '添加', exact: true }).click();
  await abbreviationRow(page, abbreviation).waitFor();
}

async function verifyCrudAndHide(page, worker) {
  await addAbbreviation(page, 'STAT3', 'signal transducer and activator 3', '信号转导子 3');
  let memory = (await rpc(page, { type: 'ABBREVIATION_MEMORY_GET' })).memory;
  const created = memory.entries.find(item => item.abbreviation === 'STAT3');
  check('UI create persists through production abbreviation RPC',
    Boolean(created?.entryId && created?.firstImportedAt), created);

  const statRow = abbreviationRow(page, 'STAT3');
  await statRow.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.locator('[data-library-editor]');
  await editor.locator('input[name="fullName"]').fill('signal transducer and activator of transcription 3');
  await editor.locator('input[name="meaningZh"]').fill('信号转导及转录激活因子 3');
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await abbreviationRow(page, 'STAT3').filter({ hasText: 'transcription 3' }).waitFor();
  memory = (await rpc(page, { type: 'ABBREVIATION_MEMORY_GET' })).memory;
  const edited = memory.entries.find(item => item.abbreviation === 'STAT3');
  check('editing full name preserves stable entry identity and import date',
    edited?.entryId === created.entryId && edited?.firstImportedAt === created.firstImportedAt &&
      edited?.fullName === 'signal transducer and activator of transcription 3', edited);

  const visibility = abbreviationRow(page, 'STAT3').getByRole('checkbox', {
    name: 'STAT3 在阅读文献时显示'
  });
  await visibility.uncheck();
  await visibility.waitFor();
  memory = (await rpc(page, { type: 'ABBREVIATION_MEMORY_GET' })).memory;
  const hidden = memory.entries.find(item => item.entryId === created.entryId);
  check('UI visibility toggle retains the term and persists hiddenFromReading',
    hidden?.hiddenFromReading === true && memory.entries.some(item => item.entryId === created.entryId),
    hidden);

  const composed = await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get(SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY);
    return SciLLM.composeArticleAbbreviations({
      paragraphs: [{ paragraphId: 'compose-qa', text: 'TNF and STAT3 are present.' }],
      automaticEntries: [
        { abbreviation: 'TNF', fullName: 'tumor necrosis factor' },
        { abbreviation: 'STAT3', fullName: 'signal transducer and activator of transcription 3' }
      ],
      globalMemory: stored[SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY]
    }).entries.map(item => item.abbreviation);
  });
  check('production composeArticleAbbreviations hides mastered term but keeps default-visible term',
    composed.includes('TNF') && !composed.includes('STAT3'), { composed });

  await addAbbreviation(page, 'DEL9', 'disposable deletion marker 9', '删除测试词');
  page.once('dialog', dialog => dialog.accept());
  await abbreviationRow(page, 'DEL9').getByRole('button', { name: '删除', exact: true }).click();
  await abbreviationRow(page, 'DEL9').waitFor({ state: 'detached' });
  memory = (await rpc(page, { type: 'ABBREVIATION_MEMORY_GET' })).memory;
  check('UI delete removes only the selected abbreviation from production storage',
    !memory.entries.some(item => item.abbreviation === 'DEL9') &&
      memory.entries.some(item => item.entryId === created.entryId),
    { entries: memory.entries.map(item => item.abbreviation) });
  return { entryId: created.entryId, firstImportedAt: created.firstImportedAt };
}

async function verifySameBrowserPageReopen(extensionId, expected, pageErrors) {
  const reopened = await openLocalLibrary(extensionId, pageErrors);
  await reopened.locator('[data-library-kind="abbreviations"]').click();
  const checkbox = abbreviationRow(reopened, 'STAT3').getByRole('checkbox', {
    name: 'STAT3 在阅读文献时显示'
  });
  await checkbox.waitFor();
  const memory = (await rpc(reopened, { type: 'ABBREVIATION_MEMORY_GET' })).memory;
  const entry = memory.entries.find(item => item.entryId === expected.entryId);
  check('closing and reopening the real options page retains edited hidden entry',
    (await checkbox.isChecked()) === false && entry?.firstImportedAt === expected.firstImportedAt,
    entry);
  await reopened.close();
}

async function verifyRestartPersistence(extensionId, worker, expected, pageErrors) {
  const page = await openLocalLibrary(extensionId, pageErrors);
  await page.locator('[data-library-kind="abbreviations"]').click();
  const checkbox = abbreviationRow(page, 'STAT3').getByRole('checkbox', {
    name: 'STAT3 在阅读文献时显示'
  });
  await checkbox.waitFor();
  const memory = (await rpc(page, { type: 'ABBREVIATION_MEMORY_GET' })).memory;
  const entry = memory.entries.find(item => item.entryId === expected.entryId);
  const composed = await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get(SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY);
    return SciLLM.composeArticleAbbreviations({
      paragraphs: [{ paragraphId: 'restart-compose-qa', text: 'TNF and STAT3 persist.' }],
      automaticEntries: [
        { abbreviation: 'TNF', fullName: 'tumor necrosis factor' },
        { abbreviation: 'STAT3', fullName: 'signal transducer and activator of transcription 3' }
      ],
      globalMemory: stored[SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY]
    }).entries.map(item => item.abbreviation);
  });
  check('browser and service-worker restart retain hidden setting, identity, and import date',
    (await checkbox.isChecked()) === false && entry?.hiddenFromReading === true &&
      entry?.firstImportedAt === expected.firstImportedAt && composed.includes('TNF') &&
      !composed.includes('STAT3'), { entry, composed });

  await page.locator('[data-library-kind="articles"]').click();
  await page.locator('[data-library-status]').filter({ hasText: '本机共 2 篇' }).waitFor();
  const cards = await page.locator('.local-library__article').count();
  check('IndexedDB workspaces and assets survive the browser restart', cards === 2, { cards });
  const screenshotPath = path.join(output, 'local-library-integrated.png');
  await page.locator('#localReadingLibrary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshotPath, fullPage: true });
  report.screenshots.push(path.relative(root, screenshotPath).replaceAll('\\', '/'));
  await page.setViewportSize({ width: 720, height: 900 });
  await page.locator('#localReadingLibrary').scrollIntoViewIfNeeded();
  const narrowMetrics = await page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    searchWidth: document.querySelector('[data-library-search]')?.getBoundingClientRect().width || 0,
    scopeWidth: document.querySelector('[data-library-scope]')?.getBoundingClientRect().width || 0
  }));
  assert.equal(narrowMetrics.pageOverflow, false, JSON.stringify(narrowMetrics));
  report.narrowMetrics = narrowMetrics;
  const narrowScreenshot = path.join(output, 'local-library-200-percent-equivalent-720.png');
  await page.screenshot({ path: narrowScreenshot, fullPage: false });
  report.screenshots.push(path.relative(root, narrowScreenshot).replaceAll('\\', '/'));
  await page.close();
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  prepareExtension();
  const pageErrors = [];
  try {
    let launched = await launch('seed-and-ui');
    context = launched.context;
    const seedPage = await context.newPage();
    seedPage.on('pageerror', error => pageErrors.push(error.message));
    await seedPage.goto(`chrome-extension://${launched.extensionId}/options.html#page=data`, {
      waitUntil: 'domcontentloaded'
    });
    await seedProductionStores(seedPage);
    await seedPage.close();

    const page = await openLocalLibrary(launched.extensionId, pageErrors);
    const initialStatus = await page.locator('[data-library-status]').textContent();
    check('real options.html loads two IndexedDB workspaces and imported abbreviations',
      /本机共\s*2\s*篇已保存文献、\s*2\s*个全局缩略词/u.test(initialStatus),
      { initialStatus });
    await verifySearchScopes(page);
    await verifyOccurrenceStats(page);
    const expected = await verifyCrudAndHide(page, launched.worker);
    await page.close();
    await verifySameBrowserPageReopen(launched.extensionId, expected, pageErrors);

    await context.close();
    context = null;
    launched = await launch('browser-and-worker-restart');
    context = launched.context;
    check('fixed manifest key keeps the extension identity stable across browser restart',
      report.launches[0].extensionId === launched.extensionId, report.launches);
    await verifyRestartPersistence(launched.extensionId, launched.worker, expected, pageErrors);

    report.pageErrors = pageErrors;
    check('the real options integration raised no page errors', pageErrors.length === 0, pageErrors);
    check('no HTTP request or real provider API was contacted',
      report.blockedNetworkRequests.length === 0 && report.realApiCalls === 0,
      { blockedNetworkRequests: report.blockedNetworkRequests, realApiCalls: report.realApiCalls });
    report.status = 'PASS';
  } catch (error) {
    report.error = error?.stack || String(error);
    process.exitCode = 1;
  } finally {
    await context?.close();
    report.extensionSourceRoot = root;
    report.runnableExtensionRoot = root;
    report.verifierPath = path.join(root, 'scripts',
      'verify-local-library-integrated-extension.mjs');
    report.temporaryTestCopy = extension;
    report.temporaryExtensionRemoved = true;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    const resolvedTemporary = path.resolve(temporary);
    if (resolvedTemporary.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(resolvedTemporary).startsWith('brevess-local-library-integrated-')) {
      fs.rmSync(resolvedTemporary, { recursive: true, force: true });
    }
  }
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length,
    report: path.join(output, 'report.json'), extensionRoot: root,
    error: report.error || '' })}\n`);
}

await run();
