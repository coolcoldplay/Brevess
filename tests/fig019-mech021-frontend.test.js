const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
function region(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start + 1) + 2);
}
test('FIG019 full Figure title retains long negative and scope qualifications', () => {
  const present = new Function(`${region('figureSummaryPresentation')}; return figureSummaryPresentation;`)();
  const title = '仅在当前模型下观察到条件特异性变化。'.repeat(12) + '未证明必要性或充分性。';
  assert.equal(present({ coreConclusion: title }).text, title);
});
test('FIG019 evidence-block heading retains all supported text instead of truncating', () => {
  const present = new Function(`${region('summarizeFigureEvidenceLabel')}; return summarizeFigureEvidenceLabel;`)();
  const title = '对照实验支持该表型在当前条件下出现。'.repeat(12) + '不能外推至未检验的组织。';
  assert.equal(present(title), title);
  assert.equal(present('', '暂无证据小结'), '暂无证据小结');
});
test('MECH021 manually opening an empty workspace never queues paid generation', () => {
  const calls = [];
  const open = new Function('switchWorkspaceView', 'renderMechanismChainWorkspace', 'currentWorkspaceSnapshot', 'mechanismWorkspaceDraft', 'activePanelTabContext', 'hasUsableLlm', 'crossFigureLogicRunning', 'mechanismChainLlmRequestKey', 'queueMicrotask', `${region('openMechanismChainWorkspace')}; return openMechanismChainWorkspace;`)(
    v => calls.push(v), () => {}, { figures: {} }, () => ({ mechanismChain: { nodes: [], initialized: false } }), { key: 'fixture' }, () => true, false, '', () => calls.push('queued AI'));
  open(); assert.deepEqual(calls, ['mechanism']);
});
test('MECH021 batch completion does not implicitly request mechanism generation', () => {
  const start = source.indexOf('async function runFigureAnalysis(');
  assert.ok(start >= 0);
  const end = source.indexOf('\nasync function ', start + 1);
  assert.doesNotMatch(source.slice(start, end), /runCrossFigureLogic\(/);
});
test('MECH021 compact module entry has distinct manual and explicit AI controls', () => {
  const entry = region('renderResearchLogicMapSnapshot');
  assert.match(entry, /图表梳理/);
  for (const label of ['手动绘制', '编辑修改', 'AI生成', '重新生成']) assert.ok(entry.includes(label), label);
  assert.match(entry, /openMechanismChainWorkspace/);
  assert.match(entry, /runCrossFigureLogic/);
  assert.match(entry, /pendingResult/);
});
