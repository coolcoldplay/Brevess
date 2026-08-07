import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.resolve(scriptDirectory, '..'));
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR ||
  path.join(path.resolve(scriptDirectory, '..'), 'output', 'playwright', 'logic-map-current'));
const userMapInput = String(process.env.SCI_LOGIC_MAP_FIXTURE || '').trim();
const userMap = userMapInput ? path.resolve(userMapInput) : '';
fs.mkdirSync(output, { recursive: true });

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.woff2', 'font/woff2'],
  ['.png', 'image/png'], ['.json', 'application/json; charset=utf-8']
]);

function staticFile(requestPath) {
  const pathname = decodeURIComponent(new URL(requestPath, 'http://127.0.0.1').pathname);
  if (pathname === '/user-map.json' && fs.existsSync(userMap)) return userMap;
  const relative = pathname === '/' ? 'logic-map.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : '';
}

const server = http.createServer((request, response) => {
  if (request.url === '/favicon.ico') {
    response.writeHead(204); response.end(); return;
  }
  const target = staticFile(request.url || '/');
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404); response.end('Not found'); return;
  }
  response.writeHead(200, {
    'content-type': mime.get(path.extname(target).toLowerCase()) || 'application/octet-stream'
  });
  fs.createReadStream(target).pipe(response);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1,
    acceptDownloads: true
  });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/logic-map.html?preview=1`, { waitUntil: 'networkidle' });
  await page.locator('#logicMapApp[aria-busy="false"]').waitFor({ state: 'visible' });
  await page.locator('.figure-stage').first().waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'logic-map-expanded.png'), fullPage: false });

  const initial = await page.evaluate(() => {
    const stages = [...document.querySelectorAll('.figure-stage')];
    const paths = [...document.querySelectorAll('#logicMapConnectorLayer path')];
    const mechanismPaths = [...document.querySelectorAll('.mechanism-edge-svg path')];
    return {
      stageCount: stages.length,
      evidenceGroupCount: document.querySelectorAll('.evidence-group-card').length,
      supplementalCount: document.querySelectorAll('.supplemental-card').length,
      figureConnectorCount: paths.filter(node => !node.getAttribute('stroke-dasharray')).length,
      groupConnectorCount: paths.filter(node => node.getAttribute('stroke-dasharray')).length,
      mechanismEdgeCount: mechanismPaths.length,
      allMechanismEdgesLong: mechanismPaths.every(node => {
        const svg = node.closest('svg');
        return (svg?.getBoundingClientRect().width || 0) >= 118;
      }),
      mainChainComplete: Boolean(
        document.querySelector('.chain-background') &&
        document.querySelector('.chain-scientific') &&
        document.querySelector('.chain-final')
      ),
      editorVisible: getComputedStyle(document.querySelector('.logic-map-inspector')).display !== 'none',
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });

  await page.locator('#collapseAllLogicMapFigures').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.figure-stage')]
    .every(stage => stage.classList.contains('is-collapsed')));
  await page.screenshot({ path: path.join(output, 'logic-map-overview-collapsed.png'), fullPage: false });
  const collapsed = await page.evaluate(() => ({
    collapsedStages: document.querySelectorAll('.figure-stage.is-collapsed').length,
    visibleEvidenceGroups: [...document.querySelectorAll('.figure-evidence-groups')]
      .filter(node => getComputedStyle(node).display !== 'none').length,
    visibleProofCards: [...document.querySelectorAll('.figure-proof-card')]
      .filter(node => getComputedStyle(node).display !== 'none').length
  }));

  await page.locator('.figure-stage .collapse-button').first().click();
  await page.waitForFunction(() => !document.querySelector('.figure-stage')
    ?.classList.contains('is-collapsed'));
  const firstStageExpanded = await page.locator('.figure-stage').first()
    .evaluate(node => !node.classList.contains('is-collapsed'));

  for (const stage of await page.locator('.figure-stage.is-collapsed').all()) {
    await stage.locator('.collapse-button').first().click();
  }
  await page.waitForFunction(() =>
    document.querySelectorAll('.figure-stage.is-collapsed').length === 0);
  await page.waitForTimeout(100);

  const supplemental = page.locator('.supplemental-card').first();
  let supplementalCollapse = { supported: false };
  if (await supplemental.count()) {
    if (await supplemental.evaluate(node => node.classList.contains('is-collapsed'))) {
      await supplemental.locator('.collapse-button').click();
      await page.waitForFunction(() => !document.querySelector('.supplemental-card')
        ?.classList.contains('is-collapsed'));
      await page.waitForTimeout(100);
    }
    const before = await page.evaluate(() => ({
      figurePaths: [...document.querySelectorAll('#logicMapConnectorLayer path')]
        .filter(node => !node.getAttribute('stroke-dasharray')).length,
      groupPaths: [...document.querySelectorAll('#logicMapConnectorLayer path')]
        .filter(node => node.getAttribute('stroke-dasharray')).length
    }));
    await supplemental.locator('.collapse-button').click();
    await page.waitForFunction(() => document.querySelector('.supplemental-card')
      ?.classList.contains('is-collapsed'));
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({
      figurePaths: [...document.querySelectorAll('#logicMapConnectorLayer path')]
        .filter(node => !node.getAttribute('stroke-dasharray')).length,
      groupPaths: [...document.querySelectorAll('#logicMapConnectorLayer path')]
        .filter(node => node.getAttribute('stroke-dasharray')).length
    }));
    supplementalCollapse = {
      supported: true, wholeFigureConnectionPreserved: after.figurePaths === before.figurePaths,
      panelGroupConnectionsHidden: after.groupPaths < before.groupPaths,
      before, after
    };
  }

  await page.locator('#toggleLogicMapEditor').click();
  await page.waitForFunction(() => document.querySelector('.logic-map-shell')
    ?.classList.contains('is-editor-collapsed'));
  const editorCollapsed = await page.evaluate(() => ({
    shellCollapsed: document.querySelector('.logic-map-shell')?.classList
      .contains('is-editor-collapsed'),
    inspectorHidden: ['none', 'hidden'].includes(
      getComputedStyle(document.querySelector('.logic-map-inspector')).display === 'none'
        ? 'none' : getComputedStyle(document.querySelector('.logic-map-inspector')).visibility
    )
  }));

  await page.locator('#toggleLogicMapFullscreen').click();
  await page.locator('body.logic-map-focus-mode').waitFor({ state: 'attached' });
  await page.screenshot({ path: path.join(output, 'logic-map-fullscreen.png'), fullPage: false });
  await page.locator('#toggleLogicMapFullscreen').click();

  const zoomBefore = await page.locator('#logicMapCanvas').evaluate(node =>
    getComputedStyle(node).getPropertyValue('--map-zoom').trim());
  await page.locator('#zoomInLogicMap').click();
  const zoomAfter = await page.locator('#logicMapCanvas').evaluate(node =>
    getComputedStyle(node).getPropertyValue('--map-zoom').trim());

  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'), page.locator('#exportLogicMapSvg').click()
  ]);
  await svgDownload.saveAs(path.join(output, 'logic-map-export.svg'));
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'), page.locator('#exportLogicMapPng').click()
  ]);
  await pngDownload.saveAs(path.join(output, 'logic-map-export.png'));

  let userMapQa = { available: false };
  if (fs.existsSync(userMap)) {
    const userPage = await browser.newPage({
      viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1
    });
    const userErrors = [];
    userPage.on('pageerror', error => userErrors.push(error.message));
    await userPage.goto(`${baseUrl}/logic-map.html?preview=1&previewData=${encodeURIComponent('/user-map.json')}`,
      { waitUntil: 'networkidle' });
    await userPage.locator('#logicMapApp[aria-busy="false"]').waitFor({ state: 'visible' });
    await userPage.locator('.figure-stage').first().waitFor({ state: 'visible' });
    await userPage.screenshot({ path: path.join(output, 'logic-map-user-data.png'), fullPage: false });
    userMapQa = await userPage.evaluate(() => ({
      available: true,
      stageCount: document.querySelectorAll('.figure-stage').length,
      collapsedStageCount: document.querySelectorAll('.figure-stage.is-collapsed').length,
      supplementalCount: document.querySelectorAll('.supplemental-card').length,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));
    userMapQa.errors = userErrors;
    await userPage.close();
  }

  const pass = Boolean(
    !consoleErrors.length && !pageErrors.length &&
    initial.stageCount >= 2 && initial.evidenceGroupCount >= 2 &&
    initial.mainChainComplete && initial.mechanismEdgeCount >= 2 &&
    initial.allMechanismEdgesLong && !initial.horizontalOverflow &&
    collapsed.collapsedStages === initial.stageCount &&
    collapsed.visibleEvidenceGroups === 0 &&
    collapsed.visibleProofCards === initial.stageCount &&
    firstStageExpanded && editorCollapsed.shellCollapsed && editorCollapsed.inspectorHidden &&
    zoomBefore !== zoomAfter &&
    (!supplementalCollapse.supported ||
      (supplementalCollapse.wholeFigureConnectionPreserved &&
       supplementalCollapse.panelGroupConnectionsHidden)) &&
    (!userMapQa.available || (!userMapQa.errors.length && userMapQa.stageCount > 0))
  );
  const result = {
    pass, initial, collapsed, firstStageExpanded, supplementalCollapse,
    editorCollapsed, zoomBefore, zoomAfter, userMapQa, consoleErrors, pageErrors,
    artifacts: {
      expanded: path.join(output, 'logic-map-expanded.png'),
      overview: path.join(output, 'logic-map-overview-collapsed.png'),
      fullscreen: path.join(output, 'logic-map-fullscreen.png'),
      userData: path.join(output, 'logic-map-user-data.png'),
      svg: path.join(output, 'logic-map-export.svg'),
      png: path.join(output, 'logic-map-export.png')
    }
  };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!pass) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
