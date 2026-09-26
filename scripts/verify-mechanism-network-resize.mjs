import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const extensionPath = path.resolve(process.env.EXTENSION_PATH || path.join(
  root, 'dist', 'Brevess-v1.0.1-build23-mechanism-network-final'
));
const graphPath = path.resolve(process.env.MECHANISM_JSON || path.join(
  root, 'output', 'playwright', 'mechanism-network-qa',
  'paper-12167935-mechanism-import.json'
));
const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(
  root, 'output', 'playwright', 'mechanism-network-build21-resize-qa'
));

if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
  throw new Error(`Missing unpacked extension: ${extensionPath}`);
}
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')).mechanismChain;
fs.mkdirSync(outputDir, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mechanism-resize-'));
let context;

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function state(page) {
  return page.evaluate(() => ({
    width: document.getElementById('mechanismNetworkViewport')?.clientWidth || 0,
    canvasWidth: document.getElementById('mechanismChainList')?.clientWidth || 0,
    internalScrollWidth: document.getElementById('mechanismNetworkViewport')?.scrollWidth || 0,
    nodeCount: document.querySelectorAll('.workspace-mechanism-node').length,
    edgeCount: document.querySelectorAll('.workspace-mechanism-edge-visible').length,
    negativeCount: document.querySelectorAll(
      '.workspace-mechanism-edge-visible.is-negative'
    ).length,
    positiveCount: document.querySelectorAll(
      '.workspace-mechanism-edge-visible.is-positive'
    ).length,
    selfLoopCount: document.querySelectorAll(
      '.workspace-mechanism-edge-visible.is-self-loop'
    ).length,
    editing: Boolean(document.querySelector('#mechanismChainList textarea')),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    resizeState: mechanismNetworkResizeController.getState()
  }));
}

try {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge', headless: true,
    viewport: { width: 700, height: 1000 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded'
  });
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.evaluate(chain => {
    const base = SciLLM.createFigureWorkspaceDraft([], {});
    const draft = SciLLM.applyFigureWorkspaceMutation(base, {
      type: 'import_mechanism_chain',
      expectedRevision: base.revision,
      chain
    }, 1);
    currentWorkspaceSnapshot = {
      title: 'Offline replay of the previously verified real-paper mechanism network',
      localWorkspace: {
        workspaceId: `workspace:${'1'.repeat(64)}`,
        workspaceGeneration: 1,
        canonicalUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12167935',
        contentHash: '2'.repeat(64)
      },
      paragraphs: [{ id: 'p1', text: 'Mechanism network resize verification.' }],
      figures: { figures: [], draft },
      figureWorkspaceDraft: draft
    };
    switchWorkspaceView('mechanism', { persist: false });
    renderMechanismChainWorkspace(currentWorkspaceSnapshot, { coordinated: true });
  }, graph);
  await page.waitForFunction(() =>
    document.querySelectorAll('.workspace-mechanism-node').length === 10 &&
    document.querySelectorAll('.workspace-mechanism-edge-visible').length === 14
  );
  const wide = await state(page);
  await page.screenshot({
    path: path.join(outputDir, 'mechanism-network-wide.png'), fullPage: true
  });

  await page.setViewportSize({ width: 380, height: 900 });
  await page.waitForFunction(() =>
    document.querySelectorAll('.workspace-mechanism-node').length === 10 &&
    Boolean(document.querySelector('.workspace-mechanism-edge-visible.is-negative')) &&
    mechanismNetworkResizeController.getState().width > 0
  );
  const narrow = await state(page);
  await page.screenshot({
    path: path.join(outputDir, 'mechanism-network-narrow.png'), fullPage: true
  });

  for (const [name, result] of [['wide', wide], ['narrow', narrow]]) {
    assert(result.nodeCount === 10, `${name}: missing nodes`);
    assert(result.edgeCount === 14, `${name}: missing edges`);
    assert(result.negativeCount >= 2, `${name}: missing negative feedback`);
    assert(result.positiveCount >= 2, `${name}: missing positive feedback`);
    assert(result.selfLoopCount === 1, `${name}: missing self loop`);
    assert(result.editing === false, `${name}: read mode opened an editor`);
    assert(result.overflow === false, `${name}: page overflow`);
  }
  assert(narrow.width < wide.width, 'narrow viewport did not reduce network width');
  assert(narrow.internalScrollWidth > narrow.width,
    'narrow readable canvas did not stay inside the scroll viewport');
  assert(narrow.resizeState.width === narrow.width,
    'resize controller did not observe the narrow mechanism viewport');

  const result = {
    pass: true,
    generatedAt: new Date().toISOString(),
    extensionPath,
    graphSource: graphPath,
    graphSourceKind: 'previously verified real-paper mechanism network',
    wide, narrow
  };
  fs.writeFileSync(
    path.join(outputDir, 'qa-result.json'), JSON.stringify(result, null, 2), 'utf8'
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context?.close().catch(() => undefined);
  fs.rmSync(profileDir, { recursive: true, force: true });
}
