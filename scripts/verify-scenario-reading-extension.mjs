import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const extensionRoot = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const outputDirectory = path.resolve(process.env.SCI_SCENARIO_READING_OUTPUT ||
  path.join(repositoryRoot, 'output', 'playwright', 'scenario-reading'));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-scenario-reading-'));
const temporaryExtension = path.join(temporaryRoot, 'extension');
const profileDirectory = path.join(temporaryRoot, 'profile');
const fixtureUrl = 'https://example.org/brevess-scenario-reading-acceptance';
const forbiddenProviderMessage =
  /ANALYZ|HIGHLIGHT_DOCUMENT|CALL_PROVIDER|TEST_PROVIDER|TEST_PROFILE/u;
const expectedDefaultScenarios = ['quick_story', 'critical_review', 'review_synthesis'];
const screenshots = ['scenario-reading-560.png', 'scenario-reading-390.png',
  'scenario-reading-320.png'];

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyExtension() {
  fs.mkdirSync(temporaryExtension, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(extensionRoot, directory), path.join(temporaryExtension, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(extensionRoot)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(extensionRoot, file), path.join(temporaryExtension, file));
    }
  }
  fs.writeFileSync(path.join(temporaryExtension, 'scenario-reading-rpc.html'),
    '<!doctype html><meta charset="utf-8"><title>Scenario reading QA RPC</title>', 'utf8');
}

function fixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
    <title>Brevess scenario reading acceptance fixture</title>
    <link rel="canonical" href="${fixtureUrl}">
    <link rel="icon" href="data:,">
    <meta name="citation_title" content="Scenario reading UI acceptance fixture">
    <meta name="citation_doi" content="10.1000/brevess-scenario-reading">
    <style>body{font:18px/1.7 Arial,sans-serif;margin:32px;color:#18212a}
      article{max-width:900px;margin:auto}</style></head><body><article>
      <h1>Scenario reading UI acceptance fixture</h1>
      <p>Established signaling programs coordinate immune adaptation, while matched
      controls and rescue experiments define the evidence boundary for causal claims.</p>
      <p>The deterministic page supplies an article-shaped local fixture only. It is not
      submitted to an LLM and it does not evaluate highlight quality.</p>
    </article></body></html>`;
}

async function extensionRpc(page, report, message) {
  report.runtimeMessages.push(String(message?.type || ''));
  const response = await page.evaluate(
    async value => chrome.runtime.sendMessage(value), message
  );
  assert.equal(response?.success, true,
    `${message.type} failed: ${JSON.stringify(response?.error || {})}`);
  return response.data;
}

async function waitForSettings(page, report, predicate, label) {
  const deadline = Date.now() + 5000;
  let settings;
  while (Date.now() < deadline) {
    settings = await extensionRpc(page, report, { type: 'LLM_GET_SETTINGS' });
    if (predicate(settings)) return settings;
    await page.waitForTimeout(75);
  }
  throw new Error(`SETTINGS_TIMEOUT:${label}:${JSON.stringify(settings?.settings || {})}`);
}

async function waitForNewExtensionPage(context, action) {
  const existing = new Set(context.pages());
  await action();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const candidate = context.pages().find(page => !existing.has(page));
    if (candidate) {
      await candidate.waitForURL(url => url.protocol === 'chrome-extension:', {
        timeout: 5000
      });
      await candidate.waitForLoadState('domcontentloaded').catch(() => undefined);
      return candidate;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('NEW_EXTENSION_PAGE_TIMEOUT');
}

async function popupSnapshot(page) {
  return page.evaluate(() => {
    const options = [...document.querySelectorAll('#readingViewOptions label')].map(label => ({
      id: label.querySelector('input')?.value || '',
      name: label.querySelector('span')?.childNodes?.[0]?.textContent?.trim() || '',
      checked: Boolean(label.querySelector('input')?.checked)
    }));
    const categories = [...document.querySelectorAll('#categoriesContainer .category-item')]
      .map(item => ({
        id: item.querySelector('input[type="checkbox"]')?.id?.replace(/^cat-/, '') || '',
        name: item.querySelector('.category-name')?.childNodes?.[0]?.textContent?.trim() || '',
        checked: Boolean(item.querySelector('input[type="checkbox"]')?.checked),
        color: getComputedStyle(item.querySelector('.category-color')).backgroundColor
      }));
    return {
      options,
      categories,
      fineCategoriesOpen: Boolean(document.querySelector('#fineCategoryDetails')?.open),
      presentationControlsHidden:
        Boolean(document.querySelector('#highlightPresentationControls')?.hidden),
      familyLegendChildren: document.querySelector('#highlightFamilyLegend')?.children.length || 0,
      densityInputCount: document.querySelectorAll('input[name="presentationDensity"]').length,
      moreCategoriesHidden: Boolean(document.querySelector('#moreCategories')?.hidden)
    };
  });
}

async function assertLayout(page, report, width, height = 900) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(120);
  const metrics = await page.evaluate(() => {
    const selectors = ['#readingViewControl', '#readingViewOptions', '#fineCategoryDetails',
      '#categoriesContainer', '#editReadingScenarios'];
    return {
      viewportWidth: innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      duplicateIds: [...document.querySelectorAll('[id]')]
        .map(node => node.id).filter((id, index, ids) => ids.indexOf(id) !== index),
      boxes: Object.fromEntries(selectors.map(selector => {
        const node = document.querySelector(selector);
        const rect = node?.getBoundingClientRect();
        return [selector, rect ? { left: rect.left, right: rect.right, width: rect.width } : null];
      }))
    };
  });
  assert.ok(metrics.documentScrollWidth <= width + 1,
    `${width}px document overflow: ${metrics.documentScrollWidth}px`);
  assert.ok(metrics.bodyScrollWidth <= width + 1,
    `${width}px body overflow: ${metrics.bodyScrollWidth}px`);
  assert.deepEqual(metrics.duplicateIds, []);
  for (const [selector, box] of Object.entries(metrics.boxes)) {
    assert.ok(box, `${selector} missing at ${width}px`);
    assert.ok(box.left >= -1 && box.right <= width + 1,
      `${selector} escapes ${width}px viewport: ${JSON.stringify(box)}`);
  }
  report.layouts[String(width)] = metrics;
  await page.screenshot({
    path: path.join(outputDirectory, `scenario-reading-${width}.png`),
    fullPage: false
  });
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const file of [...screenshots, 'report.json']) {
  fs.rmSync(path.join(outputDirectory, file), { force: true });
}
copyExtension();

const report = {
  status: 'FAIL',
  scope: {
    uiUnderTest: 'production popup.html and popup.js copied without modification',
    articleSource: 'deterministic local fixture fulfilled inside the isolated browser',
    evaluates: 'reading-scenario popup controls, persistence, navigation, and responsive layout',
    excluded: 'LLM highlight quality; root evaluates that separately with real Zotero and API'
  },
  source: {
    popupHtmlSha256: sha256File(path.join(temporaryExtension, 'popup.html')),
    popupJsSha256: sha256File(path.join(temporaryExtension, 'popup.js')),
    popupCssSha256: sha256File(path.join(temporaryExtension, 'popup.css'))
  },
  isolation: {
    temporaryExtension: true,
    temporaryProfile: true,
    dailyBrowserUsed: false,
    nativeComputerUseUsed: false,
    providerCredentialsConfigured: false
  },
  defaultScenarios: [],
  initialCategories: [],
  engineSnapshots: {},
  navigation: {},
  savedCombination: {},
  issues: [],
  layouts: {},
  runtimeMessages: [],
  popupMessages: [],
  blockedRequestUrls: [],
  apiRequests: 0,
  externalRequests: 0,
  checks: [],
  screenshots
};

let context;
try {
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'msedge',
    headless: true,
    reducedMotion: 'reduce',
    viewport: { width: 560, height: 900 },
    args: [`--disable-extensions-except=${temporaryExtension}`,
      `--load-extension=${temporaryExtension}`]
  });

  context.on('request', request => {
    const url = request.url();
    if (/^https?:\/\//u.test(url) && url !== fixtureUrl) {
      report.externalRequests += 1;
      report.blockedRequestUrls.push(url);
      if (/openai|anthropic|generativelanguage|api\.|chat\/completions|responses/u.test(url)) {
        report.apiRequests += 1;
      }
    }
  });
  await context.route(/^https?:\/\//u, route => {
    if (route.request().url() === fixtureUrl) {
      return route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8', body: fixtureHtml()
      });
    }
    return route.abort('blockedbyclient');
  });

  await context.addInitScript(() => {
    if (!globalThis.chrome?.runtime?.sendMessage ||
        !location.pathname.endsWith('/popup.html')) return;
    globalThis.__scenarioReadingMessages = [];
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...args) => {
      globalThis.__scenarioReadingMessages.push(structuredClone(message));
      return original(message, ...args);
    };
  });

  const pageErrors = [];
  const workerErrors = [];
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => {
    if (message.type() === 'error') workerErrors.push(message.text());
  });
  const extensionId = new URL(worker.url()).host;

  const fixture = await context.newPage();
  fixture.on('pageerror', error => pageErrors.push(`fixture:${error.message}`));
  await fixture.goto(fixtureUrl);
  const fixtureTab = await worker.evaluate(async url =>
    (await chrome.tabs.query({})).find(tab => tab.url === url), fixtureUrl);
  assert.ok(fixtureTab?.id, 'fixture browser tab missing');
  await worker.evaluate(async tab => {
    await SciLLM.markTabActivated(chrome.storage.session, tab);
  }, fixtureTab);

  const rpcPage = await context.newPage();
  await rpcPage.goto(`chrome-extension://${extensionId}/scenario-reading-rpc.html`);
  const fresh = await extensionRpc(rpcPage, report, { type: 'LLM_GET_SETTINGS' });
  const defaultIds = fresh.settings.analysisModes.map(mode => mode.id);
  assert.deepEqual(defaultIds, expectedDefaultScenarios);
  assert.deepEqual(Object.keys(fresh.readingViews), expectedDefaultScenarios);
  report.defaultScenarios = fresh.settings.analysisModes.map(mode => ({
    id: mode.id, name: mode.name, categoryIds: mode.categoryIds
  }));
  report.checks.push('fresh settings expose exactly the three current reading scenarios');

  await extensionRpc(rpcPage, report, {
    type: 'CATEGORY_SAVE_OVERRIDE',
    categoryId: 'scientific_question',
    override: { name: '验收科学问题', color: '#123456' }
  });

  const popup = await context.newPage();
  popup.on('pageerror', error => pageErrors.push(`popup:${error.message}`));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#readingViewOptions input').first().waitFor({ timeout: 15000 });
  await fixture.bringToFront();
  await popup.waitForTimeout(250);

  let snapshot = await popupSnapshot(popup);
  assert.deepEqual(snapshot.options.map(option => option.id), expectedDefaultScenarios);
  assert.deepEqual(snapshot.options.map(option => option.name),
    report.defaultScenarios.map(mode => mode.name));
  assert.equal(snapshot.options.find(option => option.checked)?.id, 'quick_story');
  assert.equal(snapshot.presentationControlsHidden, true);
  assert.equal(snapshot.familyLegendChildren, 0);
  assert.equal(snapshot.densityInputCount, 0);
  assert.equal(snapshot.fineCategoriesOpen, true);
  const quickStoryIds = report.defaultScenarios.find(mode => mode.id === 'quick_story').categoryIds;
  const initiallyChecked = snapshot.categories.filter(category => category.checked)
    .map(category => category.id);
  const missingQuickStoryIds = quickStoryIds.filter(id => !initiallyChecked.includes(id));
  const unexpectedQuickStoryIds = initiallyChecked.filter(id => !quickStoryIds.includes(id));
  if (missingQuickStoryIds.length || unexpectedQuickStoryIds.length) {
    report.issues.push({
      code: 'SCENARIO_CATEGORIES_FILTERED_BY_REGEX_ENGINE',
      scenarioId: 'quick_story',
      expectedCategoryIds: quickStoryIds,
      actualCheckedCategoryIds: initiallyChecked,
      missingCategoryIds: missingQuickStoryIds,
      unexpectedCategoryIds: unexpectedQuickStoryIds,
      observation: 'Fresh default regex mode does not expose the complete authoritative scenario combination.'
    });
  }
  assert.ok(initiallyChecked.every(id => quickStoryIds.includes(id)));
  report.initialCategories = snapshot.categories;
  const editedQuestion = snapshot.categories
    .find(category => category.id === 'scientific_question');
  assert.equal(editedQuestion?.name, '验收科学问题');
  assert.equal(editedQuestion?.color, 'rgb(18, 52, 86)');
  assert.match(await popup.locator('#cat-scientific_question')
    .locator('xpath=..').locator('.category-count').textContent(), /需要 LLM 识别/);
  const executableRegexRules = await popup.evaluate(tabId =>
    fetchCurrentRegexRules(tabId), fixtureTab.id);
  assert.equal(Object.hasOwn(executableRegexRules, 'scientific_question'), false);
  report.engineSnapshots.regexExecutableCategoryIds = Object.keys(executableRegexRules);
  report.checks.push('popup renders three scenarios with no density or five-family controls');
  report.checks.push('scenario categories use authoritative order, engine status, and edited color');
  report.checks.push('scenario category details start expanded with the quick-story combination');

  const scenarioOptions = await waitForNewExtensionPage(context, () =>
    popup.locator('#editReadingScenarios').click());
  report.navigation.scenarioEditorUrl = scenarioOptions.url();
  assert.equal(new URL(scenarioOptions.url()).hash, '#page=modes');
  await scenarioOptions.locator('#analysisModeSettings').waitFor({ state: 'visible' });
  await scenarioOptions.close();
  await fixture.bringToFront();
  await popup.waitForFunction(() =>
    !document.querySelector('#sidePanelApp')?.classList.contains('is-tab-inactive'));

  const firstCategory = popup.locator('#categoriesContainer .category-item')
    .filter({ has: popup.locator('input[type="checkbox"]:checked') }).first();
  const firstCategoryId = (await firstCategory.locator('input').getAttribute('id')).replace(/^cat-/, '');
  const categoryOptions = await waitForNewExtensionPage(context, () =>
    firstCategory.locator('.category-rule-button').click());
  report.navigation.categoryEditorUrl = categoryOptions.url();
  assert.ok(categoryOptions.url().includes(`category=${encodeURIComponent(firstCategoryId)}`));
  await categoryOptions.locator('#categoryWorkspace').waitFor({ state: 'visible' });
  await categoryOptions.close();
  report.checks.push('scenario and per-category edit controls open their production options pages');

  await fixture.bringToFront();
  await popup.waitForFunction(() =>
    !document.querySelector('#sidePanelApp')?.classList.contains('is-tab-inactive'));
  await popup.locator('#readingViewOptions label')
    .filter({ has: popup.locator('input[value="critical_review"]') }).click();
  const switched = await waitForSettings(rpcPage, report,
    value => value.settings.readingViewId === 'critical_review', 'critical scenario switch');
  await popup.waitForFunction(() =>
    document.querySelector('input[name="readingView"][value="critical_review"]')?.checked);
  snapshot = await popupSnapshot(popup);
  const criticalIds = switched.settings.analysisModes
    .find(mode => mode.id === 'critical_review').categoryIds;
  const actualCriticalIds = snapshot.categories.filter(category => category.checked)
    .map(category => category.id);
  const missingCriticalIds = criticalIds.filter(id => !actualCriticalIds.includes(id));
  const unexpectedCriticalIds = actualCriticalIds.filter(id => !criticalIds.includes(id));
  if (missingCriticalIds.length || unexpectedCriticalIds.length) {
    report.issues.push({
      code: 'SCENARIO_CATEGORIES_FILTERED_BY_REGEX_ENGINE',
      scenarioId: 'critical_review',
      expectedCategoryIds: criticalIds,
      actualCheckedCategoryIds: actualCriticalIds,
      missingCategoryIds: missingCriticalIds,
      unexpectedCategoryIds: unexpectedCriticalIds,
      observation: 'Scenario switch persists, but fresh default regex mode filters configured categories.'
    });
  }
  assert.ok(actualCriticalIds.every(id => criticalIds.includes(id)));
  report.checks.push('switching scenario immediately renders its configured categories');

  const checkbox = popup.locator('#categoriesContainer input[type="checkbox"]:checked').last();
  const removedCategoryId = (await checkbox.getAttribute('id')).replace(/^cat-/, '');
  assert.ok(criticalIds.length > 1, 'critical scenario must retain at least one category');
  await checkbox.uncheck();
  const saved = await waitForSettings(rpcPage, report, value => {
    const mode = value.settings.analysisModes.find(item => item.id === 'critical_review');
    return value.settings.readingViewId === 'critical_review' &&
      mode && !mode.categoryIds.includes(removedCategoryId);
  }, 'custom category combination');
  const savedIds = saved.settings.analysisModes
    .find(mode => mode.id === 'critical_review').categoryIds;

  report.popupMessages.push(...await popup.evaluate(() =>
    globalThis.__scenarioReadingMessages || []));
  await popup.reload();
  await popup.locator('#readingViewOptions input').first().waitFor({ timeout: 15000 });
  await popup.waitForFunction(() =>
    document.querySelector('input[name="readingView"][value="critical_review"]')?.checked);
  snapshot = await popupSnapshot(popup);
  assert.deepEqual(snapshot.categories.filter(category => category.checked)
    .map(category => category.id), savedIds);
  assert.equal(snapshot.categories.some(category => category.id === removedCategoryId), false);
  assert.equal(snapshot.fineCategoriesOpen, true);
  report.savedCombination = { scenarioId: 'critical_review', removedCategoryId,
    persistedCategoryIds: savedIds };
  report.checks.push('a user category combination survives a full popup reload');

  await extensionRpc(rpcPage, report, {
    type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm' }
  });
  await popup.reload();
  await popup.locator('#readingViewOptions input').first().waitFor({ timeout: 15000 });
  await popup.waitForFunction(() =>
    document.querySelector('input[name="analysisMode"][value="llm"]')?.checked);
  const llmSnapshot = await popupSnapshot(popup);
  assert.deepEqual(llmSnapshot.categories.map(category => category.id), savedIds);
  const llmRowDescriptions = await popup.locator(
    '#categoriesContainer .category-count'
  ).allTextContents();
  assert.ok(llmRowDescriptions.every(text => /LLM 语义识别|仅本次会话/u.test(text)));
  assert.ok(llmRowDescriptions.every(text =>
    !/背景与缺口|实验策略|核心结果|解释与边界|证据强度/u.test(text)));
  report.engineSnapshots.llmCategoryIds = llmSnapshot.categories.map(category => category.id);
  report.engineSnapshots.llmRowDescriptions = llmRowDescriptions;
  report.checks.push('LLM engine keeps the same authoritative scenario combination without family labels');

  await extensionRpc(rpcPage, report, {
    type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'regex' }
  });
  await popup.reload();
  await popup.locator('#readingViewOptions input').first().waitFor({ timeout: 15000 });
  await popup.waitForFunction(() =>
    document.querySelector('input[name="analysisMode"][value="regex"]')?.checked);

  for (const width of [560, 390, 320]) {
    await assertLayout(popup, report, width);
  }
  report.checks.push('production popup has no horizontal overflow at 560, 390, or 320px');

  report.popupMessages.push(...await popup.evaluate(() =>
    globalThis.__scenarioReadingMessages || []));
  const allMessages = [...report.runtimeMessages,
    ...report.popupMessages.map(message => String(message?.type || ''))];
  const forbidden = allMessages.filter(type => forbiddenProviderMessage.test(type));
  assert.deepEqual(forbidden, []);
  assert.equal(report.apiRequests, 0);
  assert.equal(report.externalRequests, 0);
  assert.deepEqual(pageErrors, []);
  report.workerErrors = workerErrors;
  report.checks.push('scenario switching and saving issued no provider task, API, or external request');
  report.status = report.issues.length ? 'FAIL' : 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(outputDirectory, 'report.json'),
    JSON.stringify(report, null, 2));
  const resolved = path.resolve(temporaryRoot);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-scenario-reading-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status,
  checks: report.checks.length,
  apiRequests: report.apiRequests,
  externalRequests: report.externalRequests,
  error: report.error
}));
