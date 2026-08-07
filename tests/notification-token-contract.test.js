const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function sliceFunctions(script, startName, endName) {
  const start = script.indexOf(`function ${startName}`);
  const end = script.indexOf(`function ${endName}`, start + 1);
  assert.ok(start >= 0 && end > start);
  return script.slice(start, end);
}

test('notification Token formatter announces input, output, total, and request count', () => {
  const popup = read('popup.js');
  const source = sliceFunctions(
    popup,
    'normalizedNotificationTokenUsage',
    'showStatus'
  );
  const context = {};
  vm.runInNewContext(
    `${source}; globalThis.formatUsage = formatNotificationTokenUsage;` +
      'globalThis.appendUsage = appendNotificationTokenUsage;',
    context
  );
  assert.equal(
    context.formatUsage({
      inputTokens: 1200,
      outputTokens: 345,
      requests: 2,
      totalTokens: 1545
    }),
    'Token：输入 1,200 · 输出 345 · 总计 1,545 · 2 次调用'
  );
  assert.match(
    context.appendUsage('逐图解读完成', {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15
    }),
    /^逐图解读完成 · Token：输入 10 · 输出 5 · 总计 15$/
  );
});

test('provider telemetry is aggregated and propagated to every completion surface', () => {
  const background = read('background.js');
  const content = read('content.js');
  const popup = read('popup.js');
  assert.match(background, /function aggregateNotificationTokenUsage/);
  assert.match(background, /reverseState\.tokenUsageEvents/);
  assert.match(background, /data:\s*\{[\s\S]*notificationUsage/);
  assert.match(content, /showLlmPageStatus\([\s\S]*response\.data\.notificationUsage/);
  assert.match(content, /turn\.usage = response\.data\.notificationUsage/);
  assert.match(content, /usage:\s*response\.data\.notificationUsage/);
  for (const workflow of [
    'runFigureAnalysis',
    'runFigurePanelFollowup',
    'runSingleFigureAnalysis',
    'runSingleFigurePanelAnalysis',
    'runCrossFigureLogic',
    'runReviewOutlineAnalysis'
  ]) {
    const start = popup.indexOf(`async function ${workflow}`);
    const end = popup.indexOf('\nasync function ', start + 1);
    const source = popup.slice(start, end < 0 ? popup.length : end);
    assert.match(source, /response\.usage/, workflow);
  }
});
