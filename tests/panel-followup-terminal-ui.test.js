const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popup = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');

function executableFunctionSource(script, name) {
  const marker = `function ${name}(`;
  const functionIndex = script.indexOf(marker);
  assert.ok(functionIndex >= 0, `${name} must exist`);
  const start = script.lastIndexOf('async ', functionIndex) === functionIndex - 6
    ? functionIndex - 6 : functionIndex;
  const bodyStart = script.indexOf('{', functionIndex);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === '{') depth += 1;
    if (script[index] === '}') depth -= 1;
    if (depth === 0) return script.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete body`);
}

class FakeClassList {
  constructor(value = '') { this.values = new Set(String(value).split(/\s+/u).filter(Boolean)); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName = 'div', className = '', textContent = '') {
    this.tagName = String(tagName).toUpperCase();
    this.className = className;
    this.classList = new FakeClassList(className);
    this.textContent = textContent;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  setAttribute(name, value) { this[name] = String(value); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { this.listeners.get(type)?.({ target: this }); }
  click() { this.dispatch('click'); }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector) {
    if (selector === 'textarea') return this.descendants().find(node => node.tagName === 'TEXTAREA') || null;
    if (selector.startsWith('.')) {
      const name = selector.slice(1);
      return this.descendants().find(node => node.classList.contains(name)) || null;
    }
    return null;
  }
  querySelectorAll(selector) {
    if (selector === 'input[type="checkbox"]:checked') {
      return this.descendants().filter(node =>
        node.tagName === 'INPUT' && node.type === 'checkbox' && node.checked);
    }
    return [];
  }
}

function loadFollowupControl({ run, refresh, showStatus, figure, generation = 1 }) {
  const source = executableFunctionSource(popup, 'createPanelFollowupControl');
  const draft = { open: true, topics: new Set(), question: '' };
  const document = {
    createElement: tag => new FakeElement(tag),
    createTextNode: text => new FakeElement('#text', '', String(text))
  };
  const createWorkspaceElement = (tag, className = '', text = '') =>
    new FakeElement(tag, className, text);
  return new Function(
    'document', 'panelWorkspaceKey', 'getPanelFollowupDraft', 'createWorkspaceElement',
    'panelFollowupPresetOptions', 'createFigurePanelUiText', 'appendPanelFollowupHistory',
    'renderArticleChatMarkdown', 'appendPanelFollowupSourceRefs', 'formatFigurePanelInputBasis',
    'runFigurePanelFollowup', 'refreshArticleWorkspace', 'showStatus', 'initialGeneration',
    `let figureTaskGeneration = initialGeneration;\nlet panelFollowupRevealKey = '';\n${source}\n` +
    'return { createPanelFollowupControl, setGeneration(value) { figureTaskGeneration = value; } };'
  )(
    document,
    (figureId, panelId) => `${figureId}:${panelId}`,
    () => draft,
    createWorkspaceElement,
    () => [],
    (_figureId, panelId) => ({ displayId: panelId }),
    () => {},
    value => new FakeElement('p', '', value),
    () => {},
    () => '',
    run,
    refresh,
    showStatus,
    generation
  );
}

async function settlePromises() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

for (const scenario of [
  { name: 'failure', code: 'INVALID_RESPONSE', expected: '追问失败，可修改问题后重试。' },
  { name: 'cancellation', code: 'CANCELLED', expected: '追问已取消，可修改问题后重试。' }
]) {
  test(`Panel follow-up ${scenario.name} refreshes the error snapshot and restores local controls`, async () => {
    const statuses = [];
    let refreshes = 0;
    const figure = { figureId: 'figure-1', panelFollowups: {}, panelFollowupErrors: {} };
    const error = Object.assign(new Error(scenario.code), { code: scenario.code });
    const harness = loadFollowupControl({
      figure,
      run: async () => { throw error; },
      refresh: async () => { refreshes += 1; },
      showStatus: (...args) => statuses.push(args)
    });
    const root = harness.createPanelFollowupControl(figure, { panel: 'A' }, '1A');
    const textarea = root.querySelector('textarea');
    textarea.value = 'Keep this draft';
    textarea.dispatch('input');
    const submit = root.querySelector('.workspace-panel-followup-submit');
    const localStatus = root.querySelector('.workspace-panel-followup-status');

    submit.click();
    assert.equal(submit.disabled, true);
    assert.equal(localStatus.classList.contains('is-loading'), true);
    await settlePromises();

    assert.equal(refreshes, 1);
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0][1], 'error');
    assert.equal(submit.disabled, false);
    assert.equal(submit.textContent, '提交追问');
    assert.equal(localStatus.classList.contains('is-loading'), false);
    assert.equal(localStatus.textContent, scenario.expected);
    assert.equal(textarea.value, 'Keep this draft');
    assert.deepEqual(figure.panelFollowups, {});
  });
}

test('a failed retry preserves the existing answer and the newly typed draft', async () => {
  const existing = { answer: 'Previously saved answer', sourceRefs: [] };
  const figure = {
    figureId: 'figure-1',
    panelFollowups: { A: existing },
    panelFollowupErrors: {}
  };
  const harness = loadFollowupControl({
    figure,
    run: async () => { throw Object.assign(new Error('retry failed'), { code: 'INVALID_RESPONSE' }); },
    refresh: async () => {},
    showStatus: () => {}
  });
  const root = harness.createPanelFollowupControl(figure, { panel: 'A' }, '1A');
  const textarea = root.querySelector('textarea');
  textarea.value = 'Retry draft';
  textarea.dispatch('input');
  root.querySelector('.workspace-panel-followup-submit').click();
  await settlePromises();
  assert.equal(figure.panelFollowups.A, existing);
  assert.equal(textarea.value, 'Retry draft');
  assert.equal(root.querySelector('.workspace-panel-followup-status').textContent,
    '回答已生成并显示在下方。');
});

test('Panel follow-up success restores the submitting control after its refreshed replacement renders', async () => {
  const figure = { figureId: 'figure-1', panelFollowups: {}, panelFollowupErrors: {} };
  const harness = loadFollowupControl({
    figure,
    run: async () => ({ success: true }),
    refresh: async () => {},
    showStatus: () => {}
  });
  const root = harness.createPanelFollowupControl(figure, { panel: 'A' }, '1A');
  const textarea = root.querySelector('textarea');
  textarea.value = 'Question';
  textarea.dispatch('input');
  const submit = root.querySelector('.workspace-panel-followup-submit');
  const localStatus = root.querySelector('.workspace-panel-followup-status');
  submit.click();
  await settlePromises();
  assert.equal(submit.disabled, false);
  assert.equal(submit.textContent, '提交追问');
  assert.equal(localStatus.classList.contains('is-loading'), false);
  assert.equal(localStatus.textContent, '回答已生成并显示在下方。');
});

test('a superseded Panel follow-up does not refresh or report into the new task generation', async () => {
  const statuses = [];
  let refreshes = 0;
  const figure = { figureId: 'figure-1', panelFollowups: {}, panelFollowupErrors: {} };
  let rejectRequest;
  const request = new Promise((_resolve, reject) => { rejectRequest = reject; });
  const harness = loadFollowupControl({
    figure,
    run: () => request,
    refresh: async () => { refreshes += 1; },
    showStatus: (...args) => statuses.push(args)
  });
  const root = harness.createPanelFollowupControl(figure, { panel: 'A' }, '1A');
  const submit = root.querySelector('.workspace-panel-followup-submit');
  root.querySelector('textarea').value = 'Question';
  root.querySelector('textarea').dispatch('input');
  submit.click();
  harness.setGeneration(2);
  rejectRequest(Object.assign(new Error('OLD_TAB_FAILED'), { code: 'INVALID_RESPONSE' }));
  await settlePromises();
  assert.equal(refreshes, 0);
  assert.equal(statuses.length, 0);
  assert.equal(submit.disabled, false);
});

test('runFigurePanelFollowup drops a successful old-tab response before mutating shared UI state', async () => {
  const source = executableFunctionSource(popup, 'runFigurePanelFollowup');
  const draft = { open: false, topics: new Set(['grouping']), question: 'draft' };
  const statuses = [];
  let refreshes = 0;
  let currentGeneration = 1;
  const maps = [new Map(), new Map()];
  const harness = new Function(
    'dependencies',
    `let figureTaskGeneration = 1;\n` +
    'const { hasUsableLlm, llmUnavailableMessage, figurePanelUiText, queryPanelTargetTab, ' +
    'isCurrentFigureTask, showStatus, sendTabMessage, panelWorkspaceKey, getPanelFollowupDraft, ' +
    'figureExpansionState, figurePanelExpansionState, refreshArticleWorkspace, ' +
    'persistCurrentArticleArchive, requestAnimationFrame, revealPanelFollowupAnswer, ' +
    `stabilizePanelFollowupAnswer } = dependencies;\nlet panelFollowupRevealKey = '';\n${source}\n` +
    'return { runFigurePanelFollowup, setGeneration(value) { figureTaskGeneration = value; } };'
  )({
    hasUsableLlm: () => true,
    llmUnavailableMessage: () => '',
    figurePanelUiText: () => ({ followupRunning: 'running', followupComplete: 'complete' }),
    queryPanelTargetTab: async () => ({ id: 7 }),
    isCurrentFigureTask: (token, tabId) => token === currentGeneration && tabId === 7,
    showStatus: (...args) => statuses.push(args),
    sendTabMessage: async () => {
      currentGeneration = 2;
      harness.setGeneration(2);
      return { success: true, usage: {} };
    },
    panelWorkspaceKey: () => 'figure-1:A',
    getPanelFollowupDraft: () => draft,
    figureExpansionState: maps[0],
    figurePanelExpansionState: maps[1],
    refreshArticleWorkspace: async () => { refreshes += 1; },
    persistCurrentArticleArchive: async () => {},
    requestAnimationFrame: callback => callback(),
    revealPanelFollowupAnswer: () => {},
    stabilizePanelFollowupAnswer: () => {}
  });

  await harness.runFigurePanelFollowup('figure-1', 'A', [], 'Question', 'Question');
  assert.equal(refreshes, 0);
  assert.equal(statuses.length, 1, 'only the pre-request running status may be emitted');
  assert.equal(draft.question, 'draft');
  assert.deepEqual([...draft.topics], ['grouping']);
  assert.equal(maps[0].size, 0);
  assert.equal(maps[1].size, 0);
});
