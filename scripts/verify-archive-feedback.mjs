import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-arch009');
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-'));
const extension = path.join(run, 'extension');
fs.mkdirSync(extension);
for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
}
for (const file of fs.readdirSync(root)) {
  if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  }
}
const report = { status: 'FAIL', startedAt: new Date().toISOString(),
  scope: 'Real popup DOM/clicks in isolated Edge; synthetic restore and failure responses',
  popupSha256: createHash('sha256').update(fs.readFileSync(path.join(extension, 'popup.js'))).digest('hex'),
  realApiCalls: 0, personalDataAccessed: false, checks: [], screenshots: [], errors: [], run };
let context;
try {
  context = await chromium.launchPersistentContext(path.join(run, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 360, height: 844 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => synchronizeActiveTabContext());
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 844 });
    for (const failureMode of ['refused', 'transport']) {
      await page.evaluate(mode => {
        // Keep real event handlers, restore control flow, status renderer and
        // notification history. Replace only external services and refreshes.
        const workspace = { workspaceId: 'workspace:fixture', workspaceGeneration: 1,
          canonicalUrl: 'https://example.test/fixture-paper', contentHash: 'fixture-revision' };
        window.archiveFeedbackCalls = [];
        activePanelTabContext.activated = true;
        document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
        capturePanelContext = () => ({ tabId: 4 });
        isCurrentPanelContext = () => true;
        beginArticleWorkspaceDirectoryPermissionRequest = () => null;
        resolveArticleWorkspaceDirectoryPermission = async () => 'granted';
        currentArticleArchiveIdentity = () => ({ documentId: 'doc:fixture',
          documentHash: 'fixture-revision', canonicalUrl: workspace.canonicalUrl });
        refreshManualAnnotationSummary = async () => {};
        refreshArticleWorkspace = async () => {};
        applyRestoredSidePanelUiState = () => {};
        rememberArticleArchivePromptDecision = async () => true;
        sendTabMessage = async (_id, message) => {
          archiveFeedbackCalls.push(message.action);
          if (message.action === 'ensureArticleWorkspace') return {
            success: true, workspace, restoreAuthorization: { token: 'fixture-only-token' }
          };
          if (message.action === 'applyArticleWorkspaceAssets') return {
            success: true, committed: true, receiptRegistered: true,
            durableFigureWorkspace: true, restoreReceipt: 'fixture-receipt', chatTurns: 2
          };
          throw Error(`Unexpected page action ${message.action}`);
        };
        sendLlmMessage = async message => {
          archiveFeedbackCalls.push(message.type);
          if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE') return {
            permission: 'granted', restore: { manifest: workspace, assets: {}, match: 'exact' }
          };
          if (message.type === 'ARTICLE_WORKSPACE_COMMIT_RESTORE') {
            if (mode === 'transport') throw Error('DIRECTORY_IO_FAILED');
            return { success: false, error: 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH' };
          }
          throw Error(`Unexpected background message ${message.type}`);
        };
        setArticleArchivePrompt({ found: true, figureCount: 14 });
      }, failureMode);
      await page.locator('#loadArticleArchive').click();
      await page.waitForFunction(() => document.getElementById('articleArchivePrompt').hidden &&
        document.getElementById('sidePanelNotificationLatest').textContent.includes('后台提交失败'));
      assert.equal(await page.locator('#articleArchivePrompt').isVisible(), false);
      const history = await page.locator('#sidePanelNotificationHistory').textContent();
      assert.match(history, /已应用.*后台提交失败.*请勿再次执行恢复/);
      assert.doesNotMatch(history, /加载本文档案失败/);
      const calls = await page.evaluate(() => window.archiveFeedbackCalls);
      assert.equal(calls.filter(c => c === 'applyArticleWorkspaceAssets').length, 1);
      assert.equal(calls.filter(c => c === 'ARTICLE_WORKSPACE_COMMIT_RESTORE').length, 1);
      assert.equal(calls.includes('ARTICLE_ARCHIVE_LOAD'), false);
      await page.locator('#sidePanelNotificationCenter').evaluate(el => { el.open = true; });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false);
      const screenshot = path.join(run, `archive-${width}-${failureMode}.png`);
      await page.screenshot({ path: screenshot });
      report.screenshots.push(screenshot);
      report.checks.push({ width, failureMode, calls, overflow,
        result: 'Partial commit notice is visible in history; old prompt hidden; no second apply/fallback' });
    }
  }
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => {
      window.archiveFeedbackCalls = [];
      window.archiveFeedbackPermissionRequests = 0;
      window.archiveFeedbackContextCurrent = true;
      window.archiveFeedbackApplyFailure = true;
      isCurrentPanelContext = () => window.archiveFeedbackContextCurrent;
      beginArticleWorkspaceDirectoryPermissionRequest = () => { window.archiveFeedbackPermissionRequests++; return null; };
      const workspace = { workspaceId: 'workspace:fixture', workspaceGeneration: 1,
        canonicalUrl: 'https://example.test/fixture-paper', contentHash: 'fixture-revision' };
      sendTabMessage = async (_id, message) => {
        archiveFeedbackCalls.push(message.action);
        if (message.action === 'ensureArticleWorkspace') return {
          success: true, workspace, restoreAuthorization: { token: 'fixture-only-token' }
        };
        if (message.action === 'applyArticleWorkspaceAssets') return window.archiveFeedbackApplyFailure
          ? { success: false, committed: false, error: 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH' }
          : { success: true, committed: true, receiptRegistered: true,
            durableFigureWorkspace: true, restoreReceipt: 'fixture-receipt' };
        throw Error(`Unexpected page action ${message.action}`);
      };
      sendLlmMessage = async message => {
        archiveFeedbackCalls.push(message.type);
        if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE') {
          await new Promise(resolve => { window.releaseArchiveFeedbackScan = resolve; });
          return { permission: 'granted', restore: { manifest: workspace, assets: {}, match: 'exact' } };
        }
        if (message.type === 'ARTICLE_WORKSPACE_COMMIT_RESTORE') return { success: true };
        throw Error(`Unexpected background message ${message.type}`);
      };
      document.getElementById('sidePanelNotificationCenter').open = false;
      setArticleArchivePrompt({ found: true, figureCount: 14 });
    });
    await page.locator('#loadArticleArchive').click();
    await page.waitForFunction(() => typeof window.releaseArchiveFeedbackScan === 'function' && articleWorkspaceRestoreGuard.isPending());
    for (const id of ['loadArticleArchive', 'scanArticleWorkspace', 'reanalyzeArticle']) {
      assert.equal(await page.locator(`#${id}`).isDisabled(), true);
      assert.equal(await page.locator(`#${id}`).getAttribute('aria-busy'), 'true');
    }
    assert.match(await page.locator('#articleArchivePromptSummary').textContent(), /14.*正在核验并加载/);
    // Native disabled clicks cannot dispatch. Also probe both public handlers to
    // verify keyboard/programmatic duplicate events share the pending operation.
    await page.evaluate(() => { void loadCurrentArticleArchive(); void scanCurrentArticleWorkspace(); });
    assert.equal(await page.evaluate(() => archiveFeedbackPermissionRequests), 1);
    let screenshot = path.join(run, `load-${width}-pending.png`);
    await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
    await page.evaluate(() => { window.releaseArchiveFeedbackScan(); delete window.releaseArchiveFeedbackScan; });
    await page.waitForFunction(() => !articleWorkspaceRestoreGuard.isPending());
    let calls = await page.evaluate(() => archiveFeedbackCalls);
    assert.equal(calls.filter(c => c === 'ARTICLE_WORKSPACE_SCAN_RESTORE').length, 1);
    assert.equal(calls.filter(c => c === 'applyArticleWorkspaceAssets').length, 1);
    assert.equal(calls.includes('ARTICLE_WORKSPACE_COMMIT_RESTORE'), false);
    assert.equal(calls.includes('ARTICLE_ARCHIVE_LOAD'), false);
    assert.match(await page.locator('#articleArchivePromptSummary').textContent(), /14.*加载未完成.*身份或恢复授权.*ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH/);
    for (const id of ['loadArticleArchive', 'scanArticleWorkspace', 'reanalyzeArticle']) {
      assert.equal(await page.locator(`#${id}`).isEnabled(), true);
      assert.equal(await page.locator(`#${id}`).getAttribute('aria-busy'), null);
    }
    const clipped = await page.evaluate(() => ['articleArchivePromptSummary', 'statusMessage'].some(id => {
      const el = document.getElementById(id);
      return el.scrollWidth > el.clientWidth + 1;
    }));
    assert.equal(clipped, false, 'Full technical failure text must wrap inside its card');
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false);
    screenshot = path.join(run, `load-${width}-identity-failure.png`);
    await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
    report.checks.push({ width, mode: 'pending-and-identity-failure', calls, overflow,
      result: 'One permission request and one apply; all triggers busy; Chinese failure retained with 14-count metadata; zero commit/fallback' });
    // A new deliberate retry may succeed and must remove the old failure card.
    await page.evaluate(() => { archiveFeedbackApplyFailure = false; archiveFeedbackCalls = []; });
    await page.locator('#loadArticleArchive').click();
    await page.waitForFunction(() => typeof window.releaseArchiveFeedbackScan === 'function');
    await page.evaluate(() => { window.releaseArchiveFeedbackScan(); delete window.releaseArchiveFeedbackScan; });
    await page.waitForFunction(() => !articleWorkspaceRestoreGuard.isPending());
    assert.equal(await page.locator('#articleArchivePrompt').isVisible(), false);
    calls = await page.evaluate(() => archiveFeedbackCalls);
    assert.equal(calls.filter(c => c === 'ARTICLE_WORKSPACE_COMMIT_RESTORE').length, 1);
    report.checks.push({ width, mode: 'deliberate-retry', calls, result: 'Successful retry clears failure card' });
    // Navigation while scanning must not apply to the newly selected paper.
    await page.evaluate(() => { archiveFeedbackCalls = []; setArticleArchivePrompt({ found: true, figureCount: 14 }); });
    await page.locator('#loadArticleArchive').click();
    await page.waitForFunction(() => typeof window.releaseArchiveFeedbackScan === 'function');
    await page.evaluate(() => {
      archiveFeedbackContextCurrent = false;
      setArticleArchivePrompt({ found: true, figureCount: 3 });
      window.releaseArchiveFeedbackScan(); delete window.releaseArchiveFeedbackScan;
    });
    await page.waitForFunction(() => !articleWorkspaceRestoreGuard.isPending());
    calls = await page.evaluate(() => archiveFeedbackCalls);
    assert.equal(calls.includes('applyArticleWorkspaceAssets'), false);
    assert.equal(calls.includes('ARTICLE_ARCHIVE_LOAD'), false);
    assert.match(await page.locator('#articleArchivePromptSummary').textContent(), /3 个图解结果/);
    assert.doesNotMatch(await page.locator('#articleArchivePromptSummary').textContent(), /14|加载未完成/);
    report.checks.push({ width, mode: 'navigation', calls, result: 'No late apply or card overwrite after navigation' });
    await page.evaluate(() => { archiveFeedbackContextCurrent = true; setArticleArchivePrompt(null); });
  }
  for (const entry of ['load', 'scan']) {
    for (const stage of ['apply', 'commit', 'refresh', 'workspace-refresh']) {
      await page.evaluate(({ entry, stage }) => {
        archiveFeedbackCalls = []; archiveFeedbackContextCurrent = true;
        window.archiveFeedbackUiChanges = 0;
        const workspace = { workspaceId: 'workspace:fixture', workspaceGeneration: 1,
          canonicalUrl: 'https://example.test/fixture-paper', contentHash: 'fixture-revision' };
        const pause = async point => {
          if (stage === point) await new Promise(resolve => { window.releaseLateRestore = resolve; });
        };
        applyRestoredSidePanelUiState = () => { archiveFeedbackUiChanges++; };
        refreshManualAnnotationSummary = async () => { await pause('refresh'); };
        refreshArticleWorkspace = async () => { await pause('workspace-refresh'); };
        sendTabMessage = async (_id, message) => {
          archiveFeedbackCalls.push(message.action);
          if (message.action === 'ensureArticleWorkspace') return {
            success: true, workspace, restoreAuthorization: { token: 'fixture-only-token' }
          };
          if (message.action === 'applyArticleWorkspaceAssets') {
            await pause('apply');
            return { success: true, committed: true, receiptRegistered: true,
              durableFigureWorkspace: true, restoreReceipt: 'fixture-receipt', uiState: { activeWorkspaceView: 'figures' } };
          }
          throw Error(`Unexpected page action ${message.action}`);
        };
        sendLlmMessage = async message => {
          archiveFeedbackCalls.push(message.type);
          if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE') return {
            permission: 'granted', restore: { manifest: workspace, assets: {}, match: 'exact' }
          };
          if (message.type === 'ARTICLE_WORKSPACE_COMMIT_RESTORE') { await pause('commit'); return { success: true }; }
          throw Error(`Unexpected background message ${message.type}`);
        };
        setArticleArchivePrompt({ found: true, figureCount: 14 });
        if (entry === 'load') void loadCurrentArticleArchive(); else void scanCurrentArticleWorkspace();
      }, { entry, stage });
      await page.waitForFunction(() => typeof window.releaseLateRestore === 'function');
      const priorUiChanges = await page.evaluate(() => {
        archiveFeedbackContextCurrent = false;
        setArticleArchivePrompt({ found: true, figureCount: 3 });
        showStatus('新论文状态', 'info');
        window.releaseLateRestore(); delete window.releaseLateRestore;
        return archiveFeedbackUiChanges;
      });
      await page.waitForFunction(() => !articleWorkspaceRestoreGuard.isPending());
      const calls = await page.evaluate(() => archiveFeedbackCalls);
      assert.equal(calls.filter(c => c === 'ARTICLE_WORKSPACE_COMMIT_RESTORE').length, 1);
      assert.equal(await page.evaluate(() => archiveFeedbackUiChanges), priorUiChanges);
      assert.match(await page.locator('#articleArchivePromptSummary').textContent(), /3 个图解结果/);
      assert.match(await page.locator('#sidePanelNotificationLatest').textContent(), /新论文状态/);
      report.checks.push({ entry, stage, calls,
        result: 'Receipt-authorized commit completes; no old UI state/card/notice enters the newly selected paper' });
    }
  }
  await page.evaluate(() => { archiveFeedbackContextCurrent = true; setArticleArchivePrompt(null); });
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [mode, expected] of [
      ['permission', '再次点击保存'], ['moved', '重新选择同一个基础目录'],
      ['io', 'QUOTA_EXCEEDED'], ['pending', '目录写入未完成']
    ]) {
      await page.evaluate(failureMode => {
        activePanelTabContext.activated = true;
        document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
        window.archiveFeedbackCalls = [];
        const workspace = { workspaceId: 'workspace:fixture', workspaceGeneration: 1 };
        sendTabMessage = async (_id, message) => {
          archiveFeedbackCalls.push(message.action);
          return message.action === 'ensureArticleWorkspace'
            ? { success: true, workspace }
            : { success: true, workspace, assetCount: 14, turnCount: 2 };
        };
        sendLlmMessage = async message => {
          archiveFeedbackCalls.push(message.type);
          if (message.type !== 'USER_DATA_SYNC_NOW') return { permission: 'granted' };
          if (failureMode === 'permission') return { permission: 'denied', requiresReauthorization: true };
          if (failureMode === 'moved') return { permission: 'granted', requiresReselection: true, failed: 1 };
          if (failureMode === 'io') return { permission: 'granted', failed: 1,
            errorCode: 'QUOTA_EXCEEDED', failedPath: 'figures/workspace-draft.json' };
          return { permission: 'granted', pendingCount: 2 };
        };
      }, mode);
      if (await page.locator('#sidePanelNotificationCenter').evaluate(el => el.open)) {
        await page.locator('#sidePanelNotificationSummary').click();
      }
      await page.locator('#saveCurrentArticleWorkspace').click();
      await page.waitForFunction(text =>
        document.getElementById('sidePanelNotificationLatest').textContent.includes(text), expected);
      const latest = await page.locator('#sidePanelNotificationLatest').textContent();
      assert.match(latest, /已保存在浏览器.*同步尚未完成/);
      assert.ok(latest.includes(expected));
      assert.doesNotMatch(latest, /可以放心关闭|同步将自动重试/);
      assert.equal(await page.locator('#saveCurrentArticleWorkspace').isEnabled(), true);
      assert.equal(await page.locator('#saveCurrentArticleWorkspace').getAttribute('aria-busy'), null);
      await page.locator('#sidePanelNotificationCenter').evaluate(el => { el.open = true; });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false);
      const screenshot = path.join(run, `sync-${width}-${mode}.png`);
      await page.screenshot({ path: screenshot });
      report.screenshots.push(screenshot);
      report.checks.push({ width, failureMode: mode, result: latest, overflow });
    }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  await context?.close();
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'latest-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    report: path.join(run, 'report.json'), failure: report.failure || null }));
}
