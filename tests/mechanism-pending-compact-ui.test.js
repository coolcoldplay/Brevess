const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'core/mechanism-pending-preview.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
const verifier = fs.readFileSync(
  path.join(root, 'scripts/verify-mechanism-pending-compact-ui.mjs'), 'utf8'
);

test('pending graph limits Mermaid to relation endpoints and retains disconnected nodes', () => {
  assert.match(core, /connectedNodeIds/u);
  assert.match(core, /nodes:\s*connectedNodes\.map/u);
  assert.match(core, /disconnectedNodes/u);
  assert.match(core, /未形成关系的候选节点/u);
  assert.match(core, /element\('details',[\s\S]*mechanism-pending-preview-nodes/u);
});

test('pending evidence provides compact source disclosure and Panel navigation hooks', () => {
  assert.match(core, /mechanism-pending-preview-source-refs/u);
  assert.match(core, /dataset\.label/u);
  assert.match(core, /dataset\.mechanismSourcePanel/u);
  assert.match(core, /查看 Panel/u);
  assert.match(popup, /querySelectorAll\('\[data-mechanism-source-panel\]'\)/u);
  assert.match(popup, /jumpToPanelFollowupSource\(\{ kind: 'panel', figureId, panelId \}/u);
});

test('pending evidence switches to labeled cards only at compact widths', () => {
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*mechanism-pending-preview-table tbody[\s\S]*display:\s*block/u);
  assert.match(css, /content:\s*attr\(data-label\)/u);
  assert.match(css, /mechanism-pending-preview-table\s*\{[\s\S]*table-layout:\s*fixed/u);
});

test('browser verifier uses retained public result at 380, 560 and 900px without API access', () => {
  assert.match(verifier, /public-mechanism-result\.json/u);
  assert.match(verifier, /const widths = \[380, 560, 900\]/u);
  assert.match(verifier, /local rendering only; no new provider or API validation/u);
  assert.match(verifier, /context\.route\(\/\^https/u);
  assert.match(verifier, /blockedNetworkRequests\.length === 0/u);
  assert.match(verifier, /pending-compact-\$\{width\}\.png/u);
});
