import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const output = path.resolve(process.env.SCI_SIDEBAR_FOCUS_OUTPUT ||
  path.join(repositoryRoot, 'output/playwright/sidebar-focus-mode-20260909'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-sidebar-focus-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
fs.mkdirSync(output, { recursive: true });

for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(sourceRoot, directory), path.join(extension, directory), { recursive: true });
}
for (const file of fs.readdirSync(sourceRoot)) {
  if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(sourceRoot, file), path.join(extension, file));
  }
}

const report = {
  status: 'FAIL',
  sourceRoot,
  fixture: 'synthetic sidebar content; zero paper/provider API calls',
  externalRequests: 0,
  providerRequests: [],
  checks: [],
  measurements: {},
  screenshots: []
};
let context;

async function metrics(page) {
  return page.evaluate(() => {
    const visible = element => {
      if (!element) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        box.width > 0 && box.height > 0;
    };
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      appWidth: document.querySelector('#sidePanelApp')?.scrollWidth || 0,
      messagesHeight: document.querySelector('#articleChatMessages')?.clientHeight || 0,
      workspaceHeight: document.querySelector('.workspace-main')?.clientHeight || 0,
      messagesScrollTop: document.querySelector('#articleChatMessages')?.scrollTop || 0,
      focusModeActive: document.querySelector('#sidePanelApp')?.classList
        .contains('is-sidebar-focus-mode') === true,
      headerVisible: visible(document.querySelector('#sidePanelHeader')),
      headerDisplay: getComputedStyle(document.querySelector('#sidePanelHeader')).display,
      paperTitleVisible: visible(document.querySelector('#sidePanelPaperTitle')),
      documentStatusVisible: visible(document.querySelector('#sidePanelDocumentStatus')),
      headingCopyVisible: visible(document.querySelector(
        '[data-workspace-view="chat"] [data-sidebar-focus-heading-copy]')),
      coverageVisible: visible(document.querySelector('#articleChatCoverage')),
      modelStatusVisible: visible(document.querySelector('#articleChatModelStatus')),
      messagesVisible: visible(document.querySelector('#articleChatMessages')),
      composerVisible: visible(document.querySelector('#articleChatForm')),
      cancelVisible: visible(document.querySelector('#sendArticleChat')),
      progressVisible: visible(document.querySelector('#mechanismGenerationStatus')),
      errorVisible: visible(document.querySelector('#statusMessage')),
      draft: document.querySelector('#articleChatQuestion')?.value || '',
      scopeText: document.querySelector('#articleChatContextScopes')?.textContent?.trim() || '',
      announcement: document.querySelector('#sidebarFocusAnnouncement')?.textContent || ''
    };
  });
}

async function screenshot(page, filename) {
  const target = path.join(output, filename);
  await page.screenshot({ path: target, fullPage: false });
  report.screenshots.push(target);
}

async function pressFocusShortcut(page, expectedActive) {
  // V is a global reading shortcut only when no editable control owns focus.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('v');
  await page.waitForFunction(expected =>
    document.querySelector('#sidePanelApp')?.classList.contains('is-sidebar-focus-mode') === expected,
  expectedActive);
}

async function setInterfaceLanguage(page, language) {
  // Persist the preference as the settings page does, then use the sidebar's
  // loader. Writing html.lang alone leaves the i18n observer in its old language.
  await page.evaluate(async selected => {
    await sendLlmMessage({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { language: selected }
    });
    await loadLlmSettings();
  }, language);
  await page.waitForFunction(selected => document.documentElement.lang === selected &&
    llmSettingsState?.settings?.language === selected, language);
}

async function verifyEditableShortcutGuard(page, expectedActive) {
  const input = page.locator('#articleChatQuestion');
  const draft = await input.inputValue();
  await input.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('v');
  assert.equal(await input.inputValue(), `${draft}v`, 'V remains ordinary draft text while typing');
  assert.equal(await page.locator('#sidePanelApp').evaluate(node =>
    node.classList.contains('is-sidebar-focus-mode')), expectedActive);
  await input.fill(draft);
  await input.evaluate(node => node.blur());
}

try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge',
    headless: true,
    reducedMotion: 'reduce',
    viewport: { width: 520, height: 760 },
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
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('#sidePanelApp').waitFor({ state: 'visible' });
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => synchronizeActiveTabContext());

  await page.evaluate(() => {
    activePanelTabContext.activated = true;
    // Component harness opens the sidebar as a tab: synchronize its visual guard, too.
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
    globalThis.__sidebarFocusMessages = [];
    const runtimeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...rest) => {
      globalThis.__sidebarFocusMessages.push({ channel: 'runtime', type: message?.type || '' });
      return runtimeSend(message, ...rest);
    };
    const tabSend = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = (tabId, message, ...rest) => {
      globalThis.__sidebarFocusMessages.push({ channel: 'tab', type: message?.type || message?.action || '' });
      return tabSend(tabId, message, ...rest);
    };
    switchWorkspaceView('chat', { persist: false });
    const status = document.querySelector('#sidePanelDocumentStatus');
    status.className = 'side-panel-document-status is-ready';
    document.querySelector('#sidePanelDocumentStatusText').textContent = '已激活 · 全文就绪';
    document.querySelector('#sidePanelPaperTitle').textContent =
      'Synthetic evidence paper title for focus-mode layout verification';
    document.querySelector('#articleChatCoverage').textContent =
      '本轮上下文：全文 118 个段落 · 约 14,200 tokens';
    document.querySelector('#articleChatModelStatus span').textContent = '模型已就绪';
    const messages = document.querySelector('#articleChatMessages');
    messages.innerHTML = Array.from({ length: 18 }, (_, index) => `
      <article class="article-chat-turn">
        <div class="article-chat-message is-assistant">
          <div class="article-chat-message-content">合成回答 ${index + 1}：证据段落用于布局与滚动验证，不发送到任何模型。</div>
        </div>
      </article>`).join('');
    const input = document.querySelector('#articleChatQuestion');
    input.value = '保留这个尚未发送的问题草稿';
    const scopes = document.querySelector('#articleChatContextScopes');
    scopes.hidden = false;
    scopes.innerHTML = '<button class="article-chat-context-chip" data-scope-id="methods">Methods</button>';
    const send = document.querySelector('#sendArticleChat');
    send.dataset.mode = 'cancel';
    document.querySelector('#sendArticleChatLabel').textContent = '取消';
    const progress = document.querySelector('#mechanismGenerationStatus');
    progress.hidden = false;
    progress.setAttribute('aria-busy', 'true');
    document.querySelector('#mechanismGenerationStage').textContent = '正在生成机制网络';
    document.querySelector('#mechanismGenerationDetail').textContent = '合成任务进度 2/4';
    document.querySelector('#cancelMechanismGeneration').hidden = false;
    const globalStatus = document.querySelector('#statusMessage');
    globalStatus.className = 'status-message side-panel-global-status error show';
    globalStatus.textContent = '合成错误边界提示';
  });
  await page.waitForTimeout(50);
  await verifyEditableShortcutGuard(page, false);

  for (const width of [520, 320]) {
    await page.setViewportSize({ width, height: 760 });
    await setInterfaceLanguage(page, 'zh-CN');
    await page.evaluate(() => {
      sidebarFocusModeController.setActive(false);
      switchWorkspaceView('chat', { persist: false });
      const status = document.querySelector('#sidePanelDocumentStatus');
      status.className = 'side-panel-document-status is-ready';
      document.querySelector('#sidePanelDocumentStatusText').textContent = '已激活 · 全文就绪';
    });
    await page.waitForTimeout(40);
    const normal = await metrics(page);
    await screenshot(page, `sidebar-focus-${width}-normal.png`);
    await pressFocusShortcut(page, true);
    await page.waitForTimeout(40);
    const focused = await metrics(page);
    await screenshot(page, `sidebar-focus-${width}-focused.png`);
    report.measurements[width] = {
      normal,
      focused,
      messagesHeightGain: focused.messagesHeight - normal.messagesHeight,
      workspaceHeightGain: focused.workspaceHeight - normal.workspaceHeight
    };
    assert.equal(normal.headerVisible, true);
    assert.equal(focused.focusModeActive, true);
    assert.equal(focused.headerVisible, false);
    assert.equal(focused.headerDisplay, 'none');
    assert.match(focused.announcement, /专注阅读已开启/u);
    assert.equal(focused.paperTitleVisible, false);
    assert.equal(focused.documentStatusVisible, false);
    assert.equal(focused.headingCopyVisible, false);
    assert.equal(focused.coverageVisible, false);
    assert.equal(focused.modelStatusVisible, true);
    assert.equal(focused.messagesVisible, true);
    assert.equal(focused.composerVisible, true);
    assert.equal(focused.cancelVisible, true);
    assert.equal(focused.progressVisible, true);
    assert.equal(focused.errorVisible, true);
    assert.equal(focused.draft, '保留这个尚未发送的问题草稿');
    assert.equal(focused.scopeText, 'Methods');
    assert.ok(focused.messagesHeight >= normal.messagesHeight + 60,
      `${width}px chat content gained only ${focused.messagesHeight - normal.messagesHeight}px`);
    assert.ok(focused.documentWidth <= focused.viewportWidth + 1,
      `${width}px document overflow ${focused.documentWidth}/${focused.viewportWidth}`);
    assert.ok(focused.appWidth <= focused.viewportWidth + 1,
      `${width}px app overflow ${focused.appWidth}/${focused.viewportWidth}`);
    await pressFocusShortcut(page, false);
    report.checks.push(`${width}px focus mode increases chat content height without overflow`);
  }

  await page.setViewportSize({ width: 520, height: 760 });
  await page.evaluate(() => {
    switchWorkspaceView('chat', { persist: false });
    const messages = document.querySelector('#articleChatMessages');
    messages.scrollTop = Math.min(210, messages.scrollHeight - messages.clientHeight);
  });
  const beforeEnterScroll = await page.locator('#articleChatMessages').evaluate(node => node.scrollTop);
  await pressFocusShortcut(page, true);
  await page.waitForTimeout(30);
  const afterEnterScroll = await page.locator('#articleChatMessages').evaluate(node => node.scrollTop);
  assert.ok(Math.abs(afterEnterScroll - beforeEnterScroll) <= 1,
    `enter moved scroll ${beforeEnterScroll} -> ${afterEnterScroll}`);
  const focusScroll = await page.locator('#articleChatMessages').evaluate(node => {
    node.scrollTop = Math.min(node.scrollTop + 110, node.scrollHeight - node.clientHeight);
    return node.scrollTop;
  });
  await pressFocusShortcut(page, false);
  await page.waitForTimeout(30);
  const afterExitScroll = await page.locator('#articleChatMessages').evaluate(node => node.scrollTop);
  assert.ok(Math.abs(afterExitScroll - focusScroll) <= 1,
    `exit returned to old position ${focusScroll} -> ${afterExitScroll}`);
  assert.ok(afterExitScroll >= afterEnterScroll,
    'focus-mode reading progress should not jump back to the pre-focus position');
  report.measurements.scroll = { beforeEnterScroll, afterEnterScroll, focusScroll, afterExitScroll };
  report.checks.push('enter and exit preserve the current chat reading position');

  await pressFocusShortcut(page, true);
  await verifyEditableShortcutGuard(page, true);
  report.checks.push('V typed into the question draft never enters or exits focus mode');
  await page.evaluate(() => switchWorkspaceView('navigation', { persist: false }));
  assert.equal(await page.locator('#sidePanelHeader').isVisible(), false);
  assert.equal(await page.locator('#sidePanelApp').evaluate(node =>
    node.classList.contains('is-sidebar-focus-mode')), true);
  await page.evaluate(() => switchWorkspaceView('mechanism', { persist: false }));
  assert.equal(await page.locator('#backFromMechanismChain').isVisible(), true);
  assert.equal(await page.locator(
    '[data-workspace-view="mechanism"] [data-sidebar-focus-heading-copy]').isVisible(), false);
  await page.evaluate(async () => {
    await openLiteratureNoteDrawer();
    document.querySelector('#literatureNoteStatus').textContent = '自动保存失败：合成存储错误';
  });
  assert.equal(await page.locator('#sidePanelHeader').isVisible(), false);
  assert.equal(await page.locator('[data-workspace-target="navigation"]').isVisible(), true);
  assert.equal(await page.locator('[data-workspace-target="notes"]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#literatureNoteStatus').isVisible(), true);
  assert.match(await page.locator('#literatureNoteStatus').innerText(), /保存失败/u);
  await page.locator('[data-workspace-target="navigation"]').click();
  assert.equal(await page.locator('#literatureNoteDrawer').isVisible(), false);
  report.checks.push('V entry and main, mechanism, and note subviews retain focus mode and save-failure status');

  await page.evaluate(() => {
    switchWorkspaceView('chat', { persist: false });
    const menu = document.querySelector('#articleChatCommandMenu');
    menu.hidden = false;
    menu.innerHTML = '<button class="article-chat-command-option">合成菜单项</button>';
    document.querySelector('#articleChatQuestion').focus();
  });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#articleChatCommandMenu').isVisible(), false);
  assert.equal(await page.locator('#sidePanelApp').evaluate(node =>
    node.classList.contains('is-sidebar-focus-mode')), true);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sidePanelApp').evaluate(node =>
    node.classList.contains('is-sidebar-focus-mode')), false);
  report.checks.push('Escape closes an existing menu before it exits focus mode');

  report.measurements.languageBeforeSwitch = await page.evaluate(() => ({
    documentLanguage: document.documentElement.lang,
    translatedNavigation: SciLLM.translateInterfaceText('导航')
  }));
  await setInterfaceLanguage(page, 'en');
  assert.equal(await page.locator('#sidebarFocusAnnouncement').textContent(), '');
  await pressFocusShortcut(page, true);
  report.measurements.languageAfterFocusEntry = await page.evaluate(() => ({
    documentLanguage: document.documentElement.lang,
    translatedNavigation: SciLLM.translateInterfaceText('导航'),
    announcement: document.querySelector('#sidebarFocusAnnouncement').textContent
  }));
  assert.match(await page.locator('#sidebarFocusAnnouncement').textContent(),
    /Focus mode on\..*Escape to exit/u);
  assert.equal(report.measurements.languageAfterFocusEntry.documentLanguage, 'en');
  assert.notEqual(report.measurements.languageAfterFocusEntry.translatedNavigation, '导航');
  // A live language change must also update an already-active announcement.
  await setInterfaceLanguage(page, 'zh-CN');
  await page.waitForFunction(() =>
    /专注阅读已开启/u.test(document.querySelector('#sidebarFocusAnnouncement').textContent));
  await setInterfaceLanguage(page, 'en');
  await page.waitForFunction(() =>
    /Focus mode on\..*Escape to exit/u.test(document.querySelector('#sidebarFocusAnnouncement').textContent));
  assert.equal(await page.locator('#sidePanelApp').evaluate(node =>
    node.classList.contains('is-sidebar-focus-mode')), true);
  await screenshot(page, 'sidebar-focus-520-english.png');
  report.checks.push('focus mode announces its active state in Chinese and English without a header button');

  await page.evaluate(() => {
    const status = document.querySelector('#sidePanelDocumentStatus');
    status.className = 'side-panel-document-status is-ready';
    document.querySelector('#sidePanelDocumentStatusText').textContent = '已激活 · 仅公开预览';
  });
  await page.waitForTimeout(40);
  assert.equal(await page.locator('#sidePanelDocumentStatus').isVisible(), true);
  assert.equal(await page.locator('#sidePanelDocumentStatus').getAttribute(
    'data-sidebar-focus-essential'), '');
  report.checks.push('public-preview access boundary remains visible in focus mode');

  const captured = await page.evaluate(() => globalThis.__sidebarFocusMessages || []);
  report.providerRequests = captured.filter(item =>
    /ANALYZ|HIGHLIGHT_DOCUMENT|CALL_PROVIDER|TEST_PROVIDER|TEST_PROFILE|ARTICLE_CHAT_SUBMIT/iu
      .test(String(item.type || '')));
  assert.deepEqual(report.providerRequests, []);
  assert.equal(report.externalRequests, 0);
  assert.deepEqual(pageErrors, []);
  report.checks.push('focus, view, and Escape interactions trigger zero provider or external requests');
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-sidebar-focus-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status,
  checks: report.checks.length,
  externalRequests: report.externalRequests,
  screenshots: report.screenshots.length,
  error: report.error
}));
