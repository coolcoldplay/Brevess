import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-arch009-prepared-ui');
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-'));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'brevess-restore-ui-'));
const extension = path.join(temporary, 'extension');
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
  scope: 'Real popup DOM/clicks in isolated Edge; synthetic content prepared-result responses and panel dirty state; real clicks/rendering, not a full backend/content end-to-end restore',
  popupSha256: createHash('sha256').update(fs.readFileSync(path.join(extension, 'popup.js'))).digest('hex'),
  realApiCalls: 0, personalDataAccessed: false, checks: [], screenshots: [], errors: [], run };
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
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
    for(const scenario of ['page-changed','panel-draft','pending-work','success']) {
      await page.evaluate(scenario=>{
        const workspace={workspaceId:'workspace:'+'a'.repeat(64),workspaceGeneration:1,canonicalUrl:'https://example.test/fixture-paper',contentHash:'1'.repeat(64)};
        window.restoreCalls=[]; literatureNoteDirtyRevisions.clear(); literatureNoteTemplateSelection=null;
        activePanelTabContext.activated=true;document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
        capturePanelContext=()=>({tabId:4});isCurrentPanelContext=()=>true;
        beginArticleWorkspaceDirectoryPermissionRequest=()=>null;
        resolveArticleWorkspaceDirectoryPermission=async()=>'granted';
        currentArticleArchiveIdentity=()=>({documentId:'doc:fixture',documentHash:'1'.repeat(64),canonicalUrl:workspace.canonicalUrl});
        sendTabMessage=async(_id,message)=>{
          if(message.action==='getFigureOriginalImageState')return{success:true,state:null};
          restoreCalls.push(message.action);
          if(message.action==='ensureArticleWorkspace')return{success:true,workspace,restoreAuthorization:{token:'fixture-restore-token'}};
          if(message.action!=='applyArticleWorkspaceAssets')throw Error('Unexpected content message: '+message.action);
          if(scenario==='panel-draft')literatureNoteDirtyRevisions.set('fixture-note-field',1);
          return {success:scenario!=='page-changed',committed:true,retryable:false,persistenceCommitted:true,
            workspaceApplied:scenario!=='page-changed',chatTurns:2,syncStatus:scenario==='pending-work'?'pending':'queued',
            manualRebuildDeferred:scenario==='pending-work',
            postCommitStatus:scenario==='page-changed'?'workspace-page-rejected-after-persistence':'complete',
            uiState:{activeWorkspaceView:'figures'}};
        };
        sendLlmMessage=async message=>{
          restoreCalls.push(message.type);
          if(message.type==='ARTICLE_WORKSPACE_SCAN_RESTORE')return{permission:'granted',restore:{manifest:workspace,match:'exact',assets:[],restorePlanId:'restore-plan-fixture'}};
          throw Error('Prepared result must not repeat persistence: '+message.type);
        };
        applyRestoredSidePanelUiState=()=>restoreCalls.push('apply-ui');
        refreshManualAnnotationSummary=async()=>restoreCalls.push('refresh-manual');
        refreshArticleWorkspace=async()=>restoreCalls.push('refresh-workspace');
        setArticleArchivePrompt({found:true,figureCount:14});
      },scenario);
      await page.locator('#loadArticleArchive').click();
      await page.waitForFunction(()=>!articleWorkspaceRestoreGuard.isPending());
      const status=await page.locator('#statusMessage').textContent();
      const calls=await page.evaluate(()=>restoreCalls);
      const operationCalls=calls.filter(call=>!['apply-ui','refresh-manual','refresh-workspace'].includes(call));
      assert.deepEqual(operationCalls,['ensureArticleWorkspace','ARTICLE_WORKSPACE_SCAN_RESTORE','applyArticleWorkspaceAssets']);
      if(scenario==='page-changed')assert.match(status,/已提交.*未覆盖.*草稿/u);
      if(scenario==='panel-draft'){
        assert.match(status,/保留.*草稿.*暂停刷新/u);
        assert.equal(await page.evaluate(()=>literatureNoteDirtyRevisions.get('fixture-note-field')),1);
      }
      if(['page-changed','panel-draft'].includes(scenario))assert.ok(!calls.some(call=>['apply-ui','refresh-manual','refresh-workspace'].includes(call)));
      else if(scenario==='pending-work'){assert.match(status,/文件夹同步尚未完成.*人工标注显示重建尚未完成/u);}
      else {assert.match(status,/已.*恢复/u);assert.ok(calls.includes('refresh-workspace'));}
      assert.equal(await page.locator('#loadArticleArchive').isEnabled(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await page.waitForFunction(()=>Number(getComputedStyle(document.getElementById('statusMessage')).opacity)>0.99);
      const screenshot=path.join(run,`${scenario}-${width}.png`);await page.screenshot({path:screenshot});report.screenshots.push(screenshot);
      report.checks.push({width,scenario,status,calls});
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
