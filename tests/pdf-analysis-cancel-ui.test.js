const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const handlerStart = popup.indexOf(
  "document.getElementById('applyHighlight').addEventListener('click'"
);
const handlerEnd = popup.indexOf(
  "\n    document.getElementById('clearAutomaticHighlights')", handlerStart
);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart,
  'production applyHighlight click handler must be extractable');
const handlerSource = popup.slice(handlerStart, handlerEnd);

function neverSettles() {
  return new Promise(() => {});
}

function createHarness(responseFactory) {
  let clickHandler = null;
  let refreshCalls = 0;
  let diagnosticsCalls = 0;
  let archiveCalls = 0;
  let sendCalls = 0;
  const statuses = [];
  const buttonStates = [];
  const context = {
    Promise,
    Set,
    regexApplyPending: false,
    analysisMode: 'llm',
    llmSettingsState: { effectiveMode: 'llm' },
    preparedDocumentState: { documentId: 'document-1', documentHash: 'hash-1' },
    llmSelectedCategories: new Set(['core_conclusion']),
    readingViewId: 'analysis',
    prepareState: 'prepared',
    highlightTaskState: { running: false, paused: false, cancelled: false },
    preferenceMutationCoordinator: { async drainLatest() {} },
    async queryPanelTargetTab() { return { id: 17 }; },
    async prepareCurrentArticleForTypeChoice() {},
    async applyHighlightPresentationToPage() {},
    async sendTabMessage() {
      sendCalls += 1;
      return responseFactory(sendCalls);
    },
    updateApplyButton() {
      buttonStates.push({
        pending: context.regexApplyPending,
        prepareState: context.prepareState,
        task: { ...context.highlightTaskState }
      });
    },
    showStatus(message, type) { statuses.push({ message, type }); },
    renderCategories() {},
    async refreshLlmDiagnostics() { diagnosticsCalls += 1; },
    refreshArticleWorkspace() {
      refreshCalls += 1;
      return neverSettles();
    },
    async persistCurrentArticleArchive() { archiveCalls += 1; },
    formatEffectiveRoute(message) { return message; },
    chrome: { runtime: { openOptionsPage() {} } },
    document: {
      getElementById(id) {
        assert.equal(id, 'applyHighlight');
        return {
          addEventListener(type, handler) {
            assert.equal(type, 'click');
            clickHandler = handler;
          }
        };
      }
    }
  };
  vm.runInNewContext(handlerSource, context, {
    filename: 'popup-apply-highlight-cancel-ui.vm.js'
  });
  assert.equal(typeof clickHandler, 'function');
  return {
    context,
    click: clickHandler,
    statuses,
    buttonStates,
    refreshCalls: () => refreshCalls,
    diagnosticsCalls: () => diagnosticsCalls,
    archiveCalls: () => archiveCalls,
    sendCalls: () => sendCalls
  };
}

async function settlesPromptly(promise, label) {
  const result = await Promise.race([
    promise.then(() => 'settled'),
    new Promise(resolve => setTimeout(() => resolve('timed-out'), 100))
  ]);
  assert.equal(result, 'settled', label);
}

test('cancelled analysis releases the apply button while auxiliary workspace refresh hangs', async () => {
  const harness = createHarness(() => ({ cancelled: true, code: 'CANCELLED' }));

  await settlesPromptly(harness.click(),
    'cancelled click handler remained blocked on auxiliary workspace refresh');
  await Promise.resolve();

  assert.equal(harness.refreshCalls(), 1);
  assert.equal(harness.context.regexApplyPending, false);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.context.highlightTaskState)),
    { running: false, paused: false, cancelled: false, phase: '', completed: 0, total: 0 });
  assert.equal(harness.context.prepareState, 'prepared');
  assert.deepEqual(harness.statuses.at(-1), {
    message: '全文 LLM 高亮已取消，已完成分块结果会保留。',
    type: 'success'
  });
  assert.deepEqual(harness.buttonStates.at(-1), {
    pending: false,
    prepareState: 'prepared',
    task: { running: false, paused: false, cancelled: false, phase: '', completed: 0, total: 0 }
  });

  await settlesPromptly(harness.click(),
    'released apply button did not permit a retry while the first refresh remained pending');
  assert.equal(harness.sendCalls(), 2);
  assert.equal(harness.context.regexApplyPending, false);
});

test('analysis error reports retained results and releases task state before refresh settles', async () => {
  const harness = createHarness(() => ({
    success: false,
    code: 'PROVIDER_UNAVAILABLE',
    error: 'provider unavailable'
  }));

  await settlesPromptly(harness.click(),
    'failed click handler remained blocked on auxiliary workspace refresh');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(harness.diagnosticsCalls(), 1);
  assert.equal(harness.refreshCalls(), 1);
  assert.equal(harness.archiveCalls(), 0,
    'archive remains ordered after the intentionally pending workspace refresh');
  assert.equal(harness.context.regexApplyPending, false);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.context.highlightTaskState)),
    { running: false, paused: false, cancelled: false, phase: '', completed: 0, total: 0 });
  assert.deepEqual(harness.statuses.at(-1), {
    message: 'LLM 分析未全部完成；已完成分块和高亮均已保留。再次点击只会重试未完成分块。',
    type: 'error'
  });
  assert.deepEqual(harness.buttonStates.at(-1), {
    pending: false,
    prepareState: 'prepared',
    task: { running: false, paused: false, cancelled: false, phase: '', completed: 0, total: 0 }
  });
});
