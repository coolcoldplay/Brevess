const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(
  __dirname, '..', 'scripts', 'verify-figure-panel-completion-ui.mjs'
), 'utf8');

test('Panel completion browser verifier uses retained output and production presentation source', () => {
  assert.match(source, /public-panel-result\.json/u);
  assert.match(source, /completedStandaloneFigurePanelIds/u);
  assert.match(source, /figureWorkspaceResultStatus/u);
  assert.match(source, /renderFigureProgress/u);
  assert.match(source, /sourceHashes/u);
});

test('Panel completion browser verifier covers terminal and persistence boundaries', () => {
  for (const id of [
    'single-panel', 'panel-followup', 'full-pending-save', 'full-pending-with-old-panel',
    'checkpoint-pending-save', 'failed', 'cancelled', 'restored'
  ]) assert.match(source, new RegExp(`id: '${id}'`));
  assert.match(source, /正在完成校验与保存/u);
  assert.match(source, /已解读 1 个 Panel/u);
});

test('Panel completion browser verifier blocks network and writes visual evidence', () => {
  assert.match(source, /context\.route\(\/\^https/u);
  assert.match(source, /blockedNetworkRequests\.length === 0/u);
  assert.match(source, /figure-panel-completion-560\.png/u);
  assert.match(source, /report\.json/u);
});
