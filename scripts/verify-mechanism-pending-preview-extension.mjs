// Isolated browser acceptance for the read-only pending mechanism preview.
// Production validators, graph generation, Mermaid, and renderer are loaded
// from a complete copied extension; all HTTP(S) requests are blocked.
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
  path.join(root, 'output/playwright/mechanism-pending-preview'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mechanism-pending-preview-'));
const extension = path.join(temporary, 'extension');
const profile = path.join(temporary, 'profile');
const report = {
  scenario: 'production node-v2 validator + read-only pending preview + strict Mermaid',
  provider: 'none', realApiCalls: 0, blockedNetworkRequests: [], checks: [],
  screenshots: [], sourceHashes: {}, status: 'FAIL'
};
let context;

function check(name, value, details = undefined) {
  assert.ok(value, details === undefined ? name : `${name}: ${JSON.stringify(details)}`);
  report.checks.push(details === undefined ? { name, pass: true } : { name, pass: true, details });
  process.stdout.write(`PASS ${name}\n`);
}

function sourceHash(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath)))
    .digest('hex');
}

function copyExtension() {
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
    'core/evidence-first-mechanism.js', 'core/figure-workspace.js',
    'core/mechanism-network.js', 'core/mechanism-pending-preview.js',
    'vendor/mermaid/mermaid.min.js'
  ]) report.sourceHashes[relativePath] = sourceHash(relativePath);
  fs.writeFileSync(path.join(extension, 'mechanism-pending-preview-fixture.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Pending mechanism preview QA</title>
<style>
body{font:14px system-ui;margin:24px;color:#173f53;background:#f5f7f4}#host{max-width:1100px;margin:auto}
section{background:#fff;border:1px solid #cbd9df;border-radius:12px;padding:16px;margin:12px 0}
.workspace-mechanism-matrix-scroll{overflow:auto}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d8e2e7;padding:8px;vertical-align:top}li{margin:5px 0}.mermaid svg{max-width:100%}
</style></head><body><main id="host"></main>
<script src="core/evidence-first-mechanism.js"></script>
<script src="core/figure-workspace.js"></script>
<script src="core/mechanism-network.js"></script>
<script src="vendor/mermaid/mermaid.min.js"></script>
<script src="core/mechanism-pending-preview.js"></script>
</body></html>`);
}

function pendingPreviewFixture() {
  const n1 = `node-v2-${'1'.repeat(16)}`;
  const n2 = `node-v2-${'2'.repeat(16)}`;
  const n3 = `node-v2-${'6'.repeat(16)}`;
  const relationId = `relation-v1-${'1'.repeat(16)}`;
  const claim = value => `claim-v1-${String(value).repeat(16)}`;
  const source = value => `source-v2-${String(value).repeat(16)}`;
  const claims = [
    ['figure-1:A', 'causal', 'necessity', 'supports', 'increases'],
    ['figure-1:B', 'causal', 'necessity', 'refutes', 'increases'],
    ['figure-2:A', 'descriptive', 'none', 'supports', 'unknown'],
    ['figure-2:B', 'descriptive', 'none', 'inconclusive', 'unknown'],
    ['figure-3:A', 'descriptive', 'none', 'inconclusive', 'unknown']
  ].map((item, index) => ({
    claimId: claim(index + 1), panelKey: item[0], semantics: item[1],
    causalTest: item[2], outcome: item[3], effectSign: item[4],
    sourceAnalysisDigest: source(index + 1), sourceRefs: [`${item[0]}:directObservation`]
  }));
  return {
    status: 'needs_review', canonicalDigest: `mechanism-v3-sha256-${'a'.repeat(64)}`,
    nodes: [
      { nodeId: n1, label: 'Microglial TNF', nodeType: 'intervention' },
      { nodeId: n2, label: 'Synapse loss', nodeType: 'outcome' },
      { nodeId: n3, label: 'Astrocyte state', nodeType: 'state' }
    ],
    relations: [{
      relationId, sourceNodeId: n1, targetNodeId: n2, relationKind: 'causal',
      relationStatus: 'supported', renderable: true, polarity: 'increases',
      context: { species: 'mouse', tissue: 'brain', cellType: 'microglia',
        compartment: '', condition: 'injury', timepoint: '', dose: '' },
      assignments: [
        { claimId: claim(1), panelKey: 'figure-1:A', evidenceClass: 'necessity',
          role: 'supporting', claimRelationKind: 'causal',
          sourceRefs: ['figure-1:A:directObservation'] },
        { claimId: claim(2), panelKey: 'figure-1:B', evidenceClass: 'other',
          role: 'counterclaim', claimRelationKind: 'causal',
          sourceRefs: ['figure-1:B:directObservation'] }
      ]
    }],
    claims,
    nodeEvidence: [{ claimId: claim(3), panelKey: 'figure-2:A', nodeIds: [n3],
      evidenceKind: 'node_observation' }],
    nonGraphEvidence: [{ claimId: claim(4), panelKey: 'figure-2:B',
      sourceNodeId: n1, targetNodeId: n2, evidenceKind: 'inconclusive' }],
    claimUsages: [
      { claimId: claim(1), panelKey: 'figure-1:A', usageKind: 'relation',
        relationIds: [relationId], nodeIds: [n1, n2], evidenceClass: 'necessity', color: 'blue' },
      { claimId: claim(2), panelKey: 'figure-1:B', usageKind: 'counterclaim',
        relationIds: [relationId], nodeIds: [n1, n2], evidenceClass: 'other', color: 'purple' },
      { claimId: claim(3), panelKey: 'figure-2:A', usageKind: 'node_observation',
        relationIds: [], nodeIds: [n3], evidenceClass: 'other', color: 'black' },
      { claimId: claim(4), panelKey: 'figure-2:B', usageKind: 'inconclusive',
        relationIds: [], nodeIds: [n1, n2], evidenceClass: 'other', color: 'amber' }
    ],
    unresolvedClaims: [{ claimId: claim(5), panelKey: 'figure-3:A',
      reason: 'ambiguous_target' }],
    panelDispositions: [
      { panelKey: 'figure-1:A', status: 'linked_causal', relationIds: [relationId],
        nodeIds: [n1, n2], claimIds: [claim(1)], reason: '' },
      { panelKey: 'figure-1:B', status: 'linked_causal', relationIds: [relationId],
        nodeIds: [n1, n2], claimIds: [claim(2)], reason: '' },
      { panelKey: 'figure-2:A', status: 'node_evidence', relationIds: [],
        nodeIds: [n3], claimIds: [claim(3)], reason: '' },
      { panelKey: 'figure-2:B', status: 'unresolved', relationIds: [],
        nodeIds: [n1, n2], claimIds: [claim(4)], reason: 'inconclusive_evidence' },
      { panelKey: 'figure-3:A', status: 'unresolved', relationIds: [],
        nodeIds: [], claimIds: [claim(5)], reason: 'ambiguous_target' },
      { panelKey: 'figure-4:A', status: 'excluded_schematic', relationIds: [],
        nodeIds: [], claimIds: [], reason: 'source_backed_schematic' }
    ]
  };
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  copyExtension();
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge', headless: true, reducedMotion: 'reduce',
      viewport: { width: 1280, height: 1000 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    await context.route(/^https?:\/\//u, route => {
      const url = route.request().url();
      report.blockedNetworkRequests.push(url);
      if (/api\.|chat\/completions|\/responses(?:\?|$)/iu.test(url)) report.realApiCalls += 1;
      return route.abort('blockedbyclient');
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/mechanism-pending-preview-fixture.html`, {
      waitUntil: 'domcontentloaded'
    });
    const preview = pendingPreviewFixture();
    const rendered = await page.evaluate(async fixture => {
      const oldChain = {
        nodes: [{ id: 'old-node', label: 'Reader-owned saved node' }],
        edges: []
      };
      await chrome.storage.local.set({ qaSavedMechanismChain: oldChain });
      const before = JSON.stringify((await chrome.storage.local.get('qaSavedMechanismChain'))
        .qaSavedMechanismChain);
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: 'base',
        flowchart: { htmlLabels: false }
      });
      const section = await SciLLM.renderMechanismPendingPreview(fixture, { mermaid });
      document.getElementById('host').append(section);
      const afterValue = (await chrome.storage.local.get('qaSavedMechanismChain'))
        .qaSavedMechanismChain;
      const after = JSON.stringify(afterValue);
      const beforeChildren = document.getElementById('host').childElementCount;
      const forged = structuredClone(fixture);
      forged.nodes[0].nodeId = forged.nodes[0].nodeId.replace('node-v2-', 'node-v1-');
      const rejected = await SciLLM.renderMechanismPendingPreview(forged, { mermaid });
      if (rejected) document.getElementById('host').append(rejected);
      const text = section.textContent;
      return {
        before, after, afterValue, oldChain,
        rejectedIsNull: rejected === null,
        invalidChangedHost: document.getElementById('host').childElementCount !== beforeChildren,
        title: section.querySelector('header h3')?.textContent || '',
        previewStatus: section.dataset.previewStatus,
        relationRows: section.querySelectorAll('[data-relation-id]').length,
        nodeItems: [...section.querySelectorAll('.mechanism-pending-preview-nodes li')]
          .map(item => item.textContent),
        evidenceText: section.querySelector('.mechanism-pending-preview-evidence')?.textContent || '',
        nonRelationText: section.querySelector('.mechanism-pending-preview-nonrelation')?.textContent || '',
        svg: section.querySelector('.mechanism-pending-preview-diagram svg')?.outerHTML || '',
        svgText: section.querySelector('.mechanism-pending-preview-diagram svg')?.textContent || '',
        svgNodeCount: section.querySelectorAll('.mechanism-pending-preview-diagram svg g.node').length,
        svgEdgeCount: section.querySelectorAll(
          '.mechanism-pending-preview-diagram svg path.flowchart-link, ' +
          '.mechanism-pending-preview-diagram svg g.edgePath'
        ).length,
        buttons: section.querySelectorAll('button,input,select,textarea,[contenteditable]').length,
        scripts: section.querySelectorAll('script,iframe,object,embed').length,
        text
      };
    }, preview);
    check('valid needs_review preview renders with the explicit non-committed heading',
      rendered.previewStatus === 'needs_review' &&
        rendered.title === '待核验预览（尚未替换已保存机制网络）', rendered);
    check('graph and table show exact upstream, relation nature, downstream, and Panel evidence',
      rendered.relationRows === 1 && rendered.evidenceText.includes('Microglial TNF') &&
        rendered.evidenceText.includes('Synapse loss') && rendered.evidenceText.includes('因果') &&
        rendered.evidenceText.includes('figure-1:A') && rendered.evidenceText.includes('figure-1:B'),
      { relationRows: rendered.relationRows, evidenceText: rendered.evidenceText });
    check('isolated node remains visible in the disconnected-node disclosure',
      rendered.nodeItems.length === 1 &&
        rendered.nodeItems.some(item => item.includes('Astrocyte state')), rendered.nodeItems);
    check('unresolved, inconclusive, node-only, and schematic Panels all remain visible',
      ['figure-2:A', 'figure-2:B', 'figure-3:A', 'figure-4:A', '节点观察', '证据不足',
        '未解析证据', '示意图'].every(value => rendered.nonRelationText.includes(value)),
      rendered.nonRelationText);
    check('strict Mermaid prioritizes relation endpoints without executable markup',
      rendered.svgNodeCount === 2 && rendered.svgEdgeCount >= 1 &&
        ['Microglial TNF', 'Synapse loss'].every(label =>
          rendered.svgText.includes(label)) && !/<script|javascript:|onload=/iu.test(rendered.svg),
      { svgLength: rendered.svg.length, svgText: rendered.svgText,
        svgNodeCount: rendered.svgNodeCount, svgEdgeCount: rendered.svgEdgeCount });
    check('invalid node dialect returns null and leaves the existing preview untouched',
      rendered.rejectedIsNull && !rendered.invalidChangedHost, rendered);
    check('preview exposes only Panel navigation actions and writes no saved mechanism state',
      rendered.buttons === 2 && rendered.scripts === 0 && rendered.before === rendered.after &&
        rendered.afterValue?.nodes?.[0]?.label === 'Reader-owned saved node' &&
        rendered.afterValue?.edges?.length === 0, rendered);
    report.pageErrors = pageErrors;
    check('isolated preview page raised no errors', pageErrors.length === 0, pageErrors);
    check('no HTTP request or provider API was contacted',
      report.blockedNetworkRequests.length === 0 && report.realApiCalls === 0,
      { blockedNetworkRequests: report.blockedNetworkRequests, realApiCalls: report.realApiCalls });
    const screenshotPath = path.join(output, 'mechanism-pending-preview.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report.screenshots.push(path.relative(root, screenshotPath).replaceAll('\\', '/'));
    report.status = 'PASS';
  } catch (error) {
    report.error = error?.stack || String(error);
    process.exitCode = 1;
  } finally {
    await context?.close();
    report.extensionSourceRoot = root;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    const resolvedTemporary = path.resolve(temporary);
    if (resolvedTemporary.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(resolvedTemporary).startsWith('brevess-mechanism-pending-preview-')) {
      fs.rmSync(resolvedTemporary, { recursive: true, force: true });
    }
  }
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length,
    report: path.join(output, 'report.json'), error: report.error || '' })}\n`);
}

await run();
