import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'tmp', name), 'utf8'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sum = values => values.reduce((total, value) => total + value, 0);
const models = ['flash', 'pro', 'vision'].map(model => {
  const before = read(`figure-speed-r3-baseline-${model}/report.json`);
  const after = read(`figure-speed-${model === 'vision' ? 'r5' : 'r4'}-live-${model}/report.json`);
  for (const report of [before, after]) {
    assert.equal(report.outcome.status, 'PASS', `${model} real extension acceptance`);
    assert.equal(report.outcome.reloaded, true);
    assert.equal(report.outcome.figure1.substantivePanelCount + report.outcome.figure2.substantivePanelCount, 37);
    assert.equal(report.callCapRejected, false);
  }
  const beforeMs = sum(before.figureTimings.map(item => item.elapsedMs));
  const afterMs = sum(after.figureTimings.map(item => item.elapsedMs));
  return {
    model: after.configuredModel, beforeMs, afterMs,
    observedReductionPercent: Math.round((1 - afterMs / beforeMs) * 1000) / 10,
    beforeCalls: before.realApiCalls, afterCalls: after.realApiCalls,
    beforeFigures: before.figureTimings, afterFigures: after.figureTimings,
    substantivePanels: 37, savedAndReloaded: true,
    inputMode: after.outcome.figure1.inputMode,
    requestSettings: after.providerCalls.map(call => ({
      model: call.request.model, stage: call.request.pass, images: call.request.imageCount
    }))
  };
});
const serial = read('figure-speed-identical-serial/figure-results-redacted.json');
const overlap = read('figure-speed-identical-overlap/figure-results-redacted.json');
const replay = [];
for (const figure of Object.keys(serial)) {
  const { operationId: _serialOperation, ...left } = serial[figure];
  const { operationId: _overlapOperation, ...right } = overlap[figure];
  assert.deepEqual(right, left, 'every scientific result field is unchanged for the same model response');
  replay.push({ figure, scientificResultSha256: hash(left), allScientificFieldsEqual: true });
}
const native = read('native-figure-speed/report.json');
const finalPackageReplay = ['flash', 'pro'].map(model => {
  const accepted = read(`package-figure-speed-r5/${model}-replay/report.json`);
  assert.equal(accepted.outcome.status, 'PASS');
  assert.equal(accepted.outcome.reloaded, true);
  assert.equal(accepted.strictReplay, true);
  assert.equal(accepted.realApiCalls, 0);
  const liveResults = read(`figure-speed-r4-live-${model}/figure-results-redacted.json`);
  const finalResults = read(`package-figure-speed-r5/${model}-replay/figure-results-redacted.json`);
  for (const figure of Object.keys(liveResults)) {
    const { operationId: _liveOperation, ...left } = liveResults[figure];
    const { operationId: _finalOperation, ...right } = finalResults[figure];
    assert.deepEqual(right, left, `${model} final-package scientific result equality`);
  }
  return { model, strictRequestEquality: true, allScientificFieldsEqual: true, savedAndReloaded: true };
});
const report = {
  schemaVersion: 1,
  testedArticle: { doi: '10.1016/j.cell.2026.01.016', excerptParagraphs: 10, figures: 2, panels: 37 },
  package: 'Brevess-v1.0.1-reliability-20260906-figure-speed-r5',
  models, identicalResponseReplay: replay, finalPackageReplay,
  native: {
    benchmarkStatus: native.status, configuration: native.configuration,
    modes: native.modes.map(mode => ({ mode: mode.mode, elapsedMs: mode.elapsedMs,
      activeOverlapMs: mode.activeOverlapMs, allCompleted: mode.allCompleted,
      allProductionValidated: mode.allProductionValidated, allExactPanelCoverage: mode.allExactPanelCoverage }))
  },
  limits: [
    'One paired run per model on two public Figures, not a statistical non-inferiority study or all twelve Figures.',
    'Observed wall time also varies with provider load, stochastic output, schema repair and caching; call counts are retained.',
    'Serial run preceded concurrent run. Native auto/low is not the user current configuration.',
    'Native overall FAIL is retained because one serial response failed the existing copied-group interpretation validator; no retry was made.',
    'Exact replay compares every result field except operationId and verifies complete request equality, including evidence and output policy.',
    'Flash/Pro live timing was acquired on r4; final r5 adds failure-settlement and automatic-fallback ordering guards and is accepted against their exact real responses. Vision live timing is from final r5.'
  ]
};
const destination = path.join(root, 'tmp/figure-speed-comparison.json');
fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ models: models.map(({ model, beforeMs, afterMs, beforeCalls, afterCalls, observedReductionPercent }) =>
  ({ model, beforeMs, afterMs, beforeCalls, afterCalls, observedReductionPercent })), exactReplay: true,
  nativeStatus: native.status }) + '\n');
