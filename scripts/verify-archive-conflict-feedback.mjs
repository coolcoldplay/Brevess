import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-arch009-conflict');
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
  for(const width of [320,360,520]) {
    await page.setViewportSize({width,height:844});
    for(const trigger of ['loadArticleArchive','scanArticleWorkspace']) {
      await page.evaluate(()=>{
        const workspace={workspaceId:'workspace:fixture',workspaceGeneration:1,canonicalUrl:'https://example.test/fixture-paper',contentHash:'fixture-revision'};
        window.conflictCalls=[];
        activePanelTabContext.activated=true;document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
        capturePanelContext=()=>({tabId:4});isCurrentPanelContext=()=>true;
        beginArticleWorkspaceDirectoryPermissionRequest=()=>null;
        resolveArticleWorkspaceDirectoryPermission=async()=>'granted';
        currentArticleArchiveIdentity=()=>({documentId:'doc:fixture',documentHash:'fixture-revision',canonicalUrl:workspace.canonicalUrl});
        sendTabMessage=async(_id,message)=>{
          // Unrelated periodic read is outside the restore operation.
          if(message.action==='getFigureOriginalImageState')return{success:true,state:null};
          conflictCalls.push(message.action);
          if(message.action==='ensureArticleWorkspace')return{success:true,workspace,restoreAuthorization:{token:'fixture-only-token'}};
          throw Error('Must not apply conflicting values: '+message.action);
        };
        sendLlmMessage=async message=>{
          conflictCalls.push(message.type);
          if(message.type==='ARTICLE_WORKSPACE_SCAN_RESTORE')throw Object.assign(new Error('Directory and local assets differ'),{code:'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT'});
          throw Error('Must not load or commit fallback: '+message.type);
        };
        setArticleArchivePrompt({found:true,figureCount:14});
      });
      if(trigger==='scanArticleWorkspace' && !await page.locator('#scanArticleWorkspace').isVisible())await page.locator('#sidePanelMoreToolsSummary').click();
      await page.locator('#'+trigger).click();
      await page.waitForFunction(()=>!articleWorkspaceRestoreGuard.isPending());
      const result=await page.locator('#articleArchivePromptSummary').textContent();
      assert.match(result,/14.*本机.*目录.*不同.*保留.*停止.*恢复/u);
      const calls=await page.evaluate(()=>conflictCalls);
      assert.deepEqual(calls,['ensureArticleWorkspace','ARTICLE_WORKSPACE_SCAN_RESTORE']);
      assert.equal(await page.locator('#loadArticleArchive').isEnabled(),true);
      assert.equal(await page.locator('#scanArticleWorkspace').isEnabled(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      const screenshot=path.join(run,`conflict-${width}-${trigger}.png`);await page.screenshot({path:screenshot});report.screenshots.push(screenshot);
      report.checks.push({width,trigger,result,calls});
    }
  }
  assert.deepEqual(report.errors,[]);report.status='PASS';
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
