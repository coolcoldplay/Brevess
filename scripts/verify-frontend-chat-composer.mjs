import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const output = path.resolve(process.env.SCI_CHAT_COMPOSER_OUTPUT_DIR ||
  path.join(repositoryRoot, 'output/playwright/frontend-chat-composer-20260906'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-chat-composer-'));
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

const report = {
  status: 'FAIL', checks: [], screenshots: [], widths: {}, viewOverflow320: {},
  externalRequests: 0, officialReferences: [
    'https://chatgpt.com/', 'https://gemini.google.com/app'
  ]
};
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 320, height: 844 },
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
  await page.locator('#sidePanelApp').waitFor();
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    activePanelTabContext.activated = true;
    switchWorkspaceView('chat');
  });
  await page.locator('.workspace-chat-view').waitFor({ state: 'visible' });

  await page.evaluate(() => renderArticleChatSnapshot(currentWorkspaceSnapshot));
  assert.equal(await page.locator('#sendArticleChat').isDisabled(), true);
  report.checks.push('unconfigured composer preserves the real disabled send state');

  await page.evaluate(() => {
    const select = document.getElementById('articleChatProfile');
    const option = new Option(
      'DeepSeek V4 Flash Experimental — long model name for responsive verification',
      'long-model', true, true
    );
    select.replaceChildren(option);
    select.disabled = false;
    document.getElementById('sendArticleChat').disabled = false;
  });

  for (const width of [320, 360, 560]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await page.evaluate(() => {
      switchWorkspaceView('chat');
      const rect = id => {
        const box = document.getElementById(id)?.getBoundingClientRect();
        return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          width: box.width, height: box.height } : null;
      };
      const overlaps = (a, b) => a && b && a.left < b.right - 1 && a.right > b.left + 1 &&
        a.top < b.bottom - 1 && a.bottom > b.top + 1;
      const shell = document.querySelector('.article-chat-input-row')?.getBoundingClientRect();
      const textarea = rect('articleChatQuestion');
      const web = rect('articleChatWebSearch');
      const model = rect('articleChatProfile');
      const send = rect('sendArticleChat');
      return {
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        shell: shell ? { left: shell.left, right: shell.right, width: shell.width } : null,
        textarea, web, model, send,
        textareaRows: document.getElementById('articleChatQuestion')?.rows,
        modelTextOverflow: getComputedStyle(document.getElementById('articleChatProfile')).textOverflow,
        overlap: overlaps(web, model) || overlaps(model, send) || overlaps(web, send)
      };
    });
    assert.equal(metrics.overflow, false, `${width}px document overflow`);
    assert.ok(metrics.shell.left >= -0.5 && metrics.shell.right <= width + 0.5,
      `${width}px shell ${JSON.stringify(metrics.shell)}`);
    assert.equal(metrics.textareaRows, 3);
    assert.ok(metrics.textarea.height >= 78, `${width}px textarea height ${metrics.textarea.height}`);
    assert.ok(metrics.model.width >= 72, `${width}px model width ${metrics.model.width}`);
    assert.ok(metrics.send.width >= 39 && metrics.send.height >= 39,
      `${width}px send size ${metrics.send.width}x${metrics.send.height}`);
    assert.equal(metrics.modelTextOverflow, 'ellipsis');
    assert.equal(metrics.overlap, false, `${width}px toolbar overlap`);
    report.widths[width] = metrics;
    const screenshot = path.join(output, `chat-composer-${width}.png`);
    await page.evaluate(() => switchWorkspaceView('chat'));
    await page.screenshot({ path: screenshot });
    report.screenshots.push(screenshot);
  }
  report.checks.push('320/360/560px keep a three-line composer and non-overlapping toolbar');

  await page.setViewportSize({ width: 360, height: 844 });
  await page.evaluate(() => {
    switchWorkspaceView('chat');
    const select = document.getElementById('articleChatProfile');
    select.replaceChildren(new Option('Long model name', 'long-model', true, true));
    select.disabled = false;
    document.getElementById('sendArticleChat').disabled = false;
  });
  await page.locator('#articleChatQuestion').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'articleChatWebSearch');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'articleChatProfile');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'sendArticleChat');
  report.checks.push('keyboard order follows input, web search, model, then send');

  await page.evaluate(() => {
    activePanelTabContext.activated = true;
    document.getElementById('articleChatWebSearch').click();
  });
  assert.equal(await page.locator('#articleChatWebSearch').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#articleChatWebSearch').getAttribute('aria-label'), /关闭联网/);
  report.checks.push('real web-search control retains pressed-state behavior and accessible labels');

  await page.evaluate(() => {
    const snapshot = currentWorkspaceSnapshot || {};
    currentWorkspaceSnapshot = {
      ...snapshot,
      chat: { ...(snapshot.chat || {}), turns: snapshot.chat?.turns || [], loading: true }
    };
    renderArticleChatSnapshot(currentWorkspaceSnapshot);
  });
  await page.locator('#sendArticleChat[data-mode="cancel"]').waitFor();
  const stopStyle = await page.locator('#sendArticleChat').evaluate(node => ({
    label: node.getAttribute('aria-label'), mode: node.dataset.mode,
    width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
    color: getComputedStyle(node).color,
    iconGlyph: getComputedStyle(node.querySelector('i'), '::before').content
  }));
  assert.deepEqual(stopStyle.mode, 'cancel');
  assert.equal(stopStyle.label, '取消回答');
  assert.ok(stopStyle.width >= 39 && stopStyle.height >= 39);
  assert.ok(!['none', 'normal', '""'].includes(stopStyle.iconGlyph),
    `missing stop icon glyph: ${stopStyle.iconGlyph}`);
  const stopShot = path.join(output, 'chat-composer-stop-360.png');
  await page.screenshot({ path: stopShot });
  report.screenshots.push(stopShot);
  report.checks.push('stop state remains a distinct accessible fixed-size action');

  await page.evaluate(() => {
    SciLLM.setInterfaceLanguage('en');
    renderArticleChatSnapshot(currentWorkspaceSnapshot);
  });
  await page.waitForFunction(() =>
    document.getElementById('sendArticleChatLabel')?.textContent === 'Cancel response');
  assert.equal(await page.getByRole('button', { name: 'Cancel response', exact: true }).count(), 1);
  assert.equal(await page.locator('#articleChatWebSearch').getAttribute('aria-label'),
    'Disable web search for the next question');
  const englishLabels = await page.evaluate(() => ({
    model: document.getElementById('articleChatProfile')?.selectedOptions?.[0]?.textContent || '',
    highlight: document.getElementById('articleChatHighlightCategory')
      ?.selectedOptions?.[0]?.textContent || '',
    send: document.getElementById('sendArticleChatLabel')?.textContent || '',
    web: document.getElementById('articleChatWebSearch')?.getAttribute('aria-label') || ''
  }));
  assert.doesNotMatch(Object.values(englishLabels).join(' '), /[\u3400-\u9fff]/u);
  report.englishLabels = englishLabels;
  const englishShot = path.join(output, 'chat-composer-stop-en-360.png');
  await page.screenshot({ path: englishShot });
  report.screenshots.push(englishShot);
  report.checks.push('English mode translates web-search and stop-state accessible labels');

  await page.setViewportSize({ width: 320, height: 844 });
  for (const view of ['analysis', 'navigation', 'highlights', 'figures', 'mechanism', 'chat']) {
    await page.evaluate(target => switchWorkspaceView(target), view);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    report.viewOverflow320[view] = overflow;
    assert.equal(overflow, false, `${view} overflows at 320px`);
  }
  report.checks.push('all six workspace views remain free of document-level overflow at 320px');

  assert.deepEqual(pageErrors, []);
  assert.equal(report.externalRequests, 0);
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-chat-composer-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status,
  checks: report.checks.length,
  externalRequests: report.externalRequests,
  error: report.error
}));
