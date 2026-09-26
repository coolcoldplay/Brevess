const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { createSemanticFindController } = require('../semantic-find-controller.js');

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
  }

  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, extra = {}) {
    const event = { target: this, type, ...extra };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  click() { this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  closest(selector) {
    const editableTags = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'DIALOG']);
    if (selector.includes('input') && editableTags.has(this.tagName)) return this;
    return this.parentElement?.closest?.(selector) || null;
  }
}

function fakeDocument() {
  const document = {
    activeElement: null,
    createElement(tag) { return new FakeElement(tag, document); }
  };
  document.body = document.createElement('body');
  document.documentElement = document.createElement('html');
  return document;
}

function findRole(root, role) {
  if (root?.getAttribute?.('data-semantic-find-role') === role) return root;
  for (const child of root?.children || []) {
    const match = findRole(child, role);
    if (match) return match;
  }
  return null;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function corpus(overrides = {}) {
  return {
    sourceKey: 'doc:one',
    paragraphs: [{ paragraphId: 'p1', text: 'Alpha. Beta. Gamma.' }],
    sentences: [
      { id: 's1', paragraphId: 'p1', text: 'Alpha.', start: 0, end: 6 },
      { id: 's2', paragraphId: 'p1', text: 'Beta.', start: 7, end: 12 },
      { id: 's3', paragraphId: 'p1', text: 'Gamma.', start: 13, end: 19 }
    ],
    ...overrides
  };
}

function setup(options = {}) {
  const document = fakeDocument();
  const calls = { messages: [], paints: [], focuses: [], confirms: [], clears: 0, settings: [] };
  let current = true;
  const adapter = {
    async buildCorpus() { return options.buildCorpus ? options.buildCorpus() : corpus(options.corpus); },
    isCurrent() { return current; },
    paint(value, hits, currentId) {
      calls.paints.push({ corpus: value, hits: hits.map(hit => ({ ...hit })), currentId });
    },
    async focus(value, hit) {
      calls.focuses.push({ corpus: value, hit: { ...hit } });
      return options.focus?.(value, hit);
    },
    clear() { calls.clears += 1; },
    async confirm(value, hit, rect) {
      if (options.confirm) return options.confirm(value, hit, rect);
      calls.confirms.push({ corpus: value, hit: { ...hit }, rect });
      return { saved: true };
    }
  };
  const sendMessage = async message => {
    calls.messages.push(structuredClone(message));
    if (options.sendMessage) return options.sendMessage(message);
    return {
      success: true,
      data: {
        operationId: message.operationId,
        sourceKey: message.sourceKey,
        processed: 3,
        skipped: 0,
        total: 3,
        complete: true,
        scores: [
          { id: 's2', score: 0.8 },
          { id: 's1', score: 0.95 },
          { id: 's1', score: 0.95 },
          { id: 's3', score: 0.2 }
        ]
      }
    };
  };
  const controller = createSemanticFindController({
    adapter,
    sendMessage,
    openSettings(taskId) {
      calls.settings.push(taskId);
      return options.openSettings?.(taskId);
    },
    document,
    window: {}
  });
  return { document, adapter, controller, calls, setCurrent(value) { current = value; } };
}

function keyEvent(key, target, overrides = {}) {
  return {
    key,
    target,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...overrides
  };
}

test('opens without an API call and admits only known finite unique scores in source order', async () => {
  const fixture = setup({ corpus: {
    coverage: 'partial', coverageMessage: '第 4 页没有文字层'
  } });
  assert.equal(fixture.controller.open(), true);
  assert.equal(fixture.calls.messages.length, 0);
  const root = fixture.document.body.children[0];
  assert.equal(root.className, 'sci-semantic-find');
  assert.equal(root.getAttribute('data-sci-plugin-ui'), 'true');
  for (const role of fixture.controller.roles) assert.ok(findRole(root, role), role);

  const query = findRole(root, 'query');
  assert.equal(query.maxLength, 1000);
  query.value = '细胞应激';
  const event = keyEvent('Enter', query);
  assert.equal(fixture.controller.handleKeydown(event), true);
  await flush();

  const request = fixture.calls.messages.find(message => message.type === 'LLM_SEMANTIC_FIND');
  assert.equal(request.sourceKey, 'doc:one');
  assert.equal(request.query, '细胞应激');
  assert.deepEqual(request.paragraphs, corpus().paragraphs);
  assert.equal('sentences' in request, false);
  const painted = fixture.calls.paints.at(-1);
  assert.deepEqual(painted.hits.map(hit => [hit.id, hit.text, hit.score]), [
    ['s1', 'Alpha.', 0.95], ['s2', 'Beta.', 0.8]
  ]);
  assert.equal(painted.currentId, 's1');
  assert.match(findRole(root, 'progress').textContent, /已处理 3 \/ 3.*部分覆盖.*第 4 页/);
  assert.match(
    findRole(root, 'legend').children.map(child => child.textContent).join(' '),
    /模型匹配分值/
  );

  const threshold = findRole(root, 'threshold-number');
  threshold.value = '0.90';
  threshold.dispatch('change');
  assert.deepEqual(fixture.calls.paints.at(-1).hits.map(hit => hit.id), ['s1']);
  threshold.value = '0.75';
  threshold.dispatch('change');
  assert.deepEqual(fixture.calls.paints.at(-1).hits.map(hit => hit.id), ['s1', 's2']);
});

test('same-query Enter cycles results while IME and unrelated editable controls are untouched', async () => {
  const fixture = setup();
  fixture.controller.open();
  const root = fixture.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'effect';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();

  const forward = keyEvent('Enter', fixture.document.body);
  assert.equal(fixture.controller.handleKeydown(forward), true);
  assert.equal(fixture.calls.paints.at(-1).currentId, 's2');
  const backward = keyEvent('Enter', fixture.document.body, { shiftKey: true });
  fixture.controller.handleKeydown(backward);
  assert.equal(fixture.calls.paints.at(-1).currentId, 's1');

  const otherInput = fixture.document.createElement('input');
  assert.equal(fixture.controller.handleKeydown(keyEvent('Enter', otherInput)), false);
  assert.equal(fixture.controller.handleKeydown(
    keyEvent('Enter', query, { isComposing: true })
  ), false);
  assert.equal(fixture.controller.handleKeydown(
    keyEvent('Process', query)
  ), false);
  assert.equal(fixture.controller.handleKeydown(keyEvent('Escape', otherInput)), true);
  assert.equal(fixture.controller.isOpen(), false);
  assert.equal(root.hidden, true);
});

test('a superseded focus rejection cannot replace the current result status', async () => {
  const firstFocus = deferred();
  const fixture = setup({ focus: (_corpus, hit) => hit.id === 's1'
    ? firstFocus.promise : Promise.resolve() });
  fixture.controller.open();
  const root = fixture.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'effect';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  fixture.controller.handleKeydown(keyEvent('Enter', fixture.document.body));
  await flush();
  firstFocus.reject(new Error('late first focus'));
  await flush();
  assert.doesNotMatch(findRole(root, 'status').textContent, /late first focus/);
  assert.equal(fixture.calls.paints.at(-1).currentId, 's2');
});

test('changed queries and close cancel work and reject late build or response completion', async () => {
  const response = deferred();
  const fixture = setup({ sendMessage: () => response.promise });
  fixture.controller.open();
  const root = fixture.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'first';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  const firstRequest = fixture.calls.messages.find(message => message.type === 'LLM_SEMANTIC_FIND');
  query.value = 'second';
  query.dispatch('input');
  assert.ok(fixture.calls.messages.some(message =>
    message.type === 'LLM_SEMANTIC_FIND_CANCEL' &&
    message.operationId === firstRequest.operationId
  ));
  response.resolve({ success: true, data: {
    operationId: firstRequest.operationId, sourceKey: firstRequest.sourceKey,
    scores: [{ id: 's1', score: 1 }], processed: 1, skipped: 2, total: 3
  }
  });
  await flush();
  assert.equal(fixture.calls.paints.at(-1)?.hits.length || 0, 0);

  const build = deferred();
  const duringBuild = setup({ buildCorpus: () => build.promise });
  duringBuild.controller.open();
  const buildQuery = findRole(duringBuild.document.body.children[0], 'query');
  buildQuery.value = 'cancel before corpus';
  duringBuild.controller.handleKeydown(keyEvent('Enter', buildQuery));
  duringBuild.controller.close();
  build.resolve(corpus());
  await flush();
  assert.equal(duringBuild.calls.messages.some(message =>
    message.type === 'LLM_SEMANTIC_FIND'
  ), false);
});

test('progress is scoped by operation and source and terminal progress rejects late updates', async () => {
  const pending = deferred();
  const fixture = setup({ sendMessage: () => pending.promise });
  fixture.controller.open();
  const query = findRole(fixture.document.body.children[0], 'query');
  query.value = 'query';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  const request = fixture.calls.messages.find(message => message.type === 'LLM_SEMANTIC_FIND');

  assert.equal(fixture.controller.handleProgress({
    action: 'semanticFindProgress', operationId: 'wrong', sourceKey: request.sourceKey,
    progress: {}
  }), false);
  assert.equal(fixture.controller.handleProgress({
    action: 'semanticFindProgress', operationId: request.operationId, sourceKey: 'other',
    progress: {}
  }), false);
  assert.equal(fixture.controller.handleProgress({
    action: 'semanticFindProgress', operationId: request.operationId,
    sourceKey: request.sourceKey,
    progress: {
      operationId: 'forged-inner-owner', sourceKey: 'forged-inner-source',
      processed: 1, total: 3,
      scores: [{ id: 's2', score: 0.82 }, { id: 's2', score: 0.82 }]
    }
  }), true);
  assert.deepEqual(fixture.calls.paints.at(-1).hits.map(hit => [hit.id, hit.score]), [
    ['s2', 0.82]
  ]);
  assert.equal(fixture.controller.handleProgress({
    action: 'semanticFindProgress', operationId: request.operationId,
    sourceKey: request.sourceKey,
    progress: {
      processed: 3, skipped: 0, total: 3, done: true,
      scores: [{ id: 's1', score: 0.91 }, { id: 's3', score: 0.2 }]
    }
  }), true);
  assert.equal(fixture.controller.handleProgress({
    action: 'semanticFindProgress', operationId: request.operationId,
    sourceKey: request.sourceKey,
    progress: { scores: [{ id: 's3', score: 0.9 }] }
  }), false);
  pending.resolve({});
});

test('rejects coerced, non-finite, unknown, and conflicting scores explicitly', async () => {
  for (const invalid of [
    { id: 's1', score: null },
    { id: 's1', score: '' },
    { id: 's1', score: true },
    { id: 's1', score: '0.9' },
    { id: 's1', score: Infinity },
    { id: 's1', score: -0.1 },
    { id: 's1', score: 1.1 },
    { id: 'unknown', score: 0.9 }
  ]) {
    const fixture = setup({ sendMessage: message => ({ success: true, data: {
      operationId: message.operationId,
      sourceKey: message.sourceKey,
      processed: 1,
      skipped: 2,
      total: 3,
      complete: true,
      scores: [invalid]
    } }) });
    fixture.controller.open();
    const root = fixture.document.body.children[0];
    const query = findRole(root, 'query');
    query.value = 'invalid';
    fixture.controller.handleKeydown(keyEvent('Enter', query));
    await flush();
    assert.match(findRole(root, 'status').textContent, /无效|当前文档/, JSON.stringify(invalid));
    assert.equal(fixture.calls.paints.at(-1)?.hits.length || 0, 0);
  }

  const conflict = setup({ sendMessage: message => ({ success: true, data: {
    operationId: message.operationId,
    sourceKey: message.sourceKey,
    processed: 2,
    skipped: 1,
    total: 3,
    complete: true,
    scores: [{ id: 's1', score: 0.8 }, { id: 's1', score: 0.9 }]
  } }) });
  conflict.controller.open();
  const root = conflict.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'conflict';
  conflict.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  assert.match(findRole(root, 'status').textContent, /冲突分值/);
});

test('terminal coverage requires processed scores plus skipped to equal total', async () => {
  const fixture = setup({ sendMessage: message => ({ success: true, data: {
    operationId: message.operationId,
    sourceKey: message.sourceKey,
    processed: 2,
    skipped: 0,
    total: 3,
    complete: true,
    scores: [{ id: 's1', score: 0.9 }]
  } }) });
  fixture.controller.open();
  const root = fixture.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'incomplete';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  assert.match(findRole(root, 'status').textContent, /覆盖计数不一致/);
  assert.equal(findRole(root, 'status').getAttribute('data-state'), 'error');
  assert.match(findRole(root, 'progress').textContent, /部分覆盖/);
});

test('terminal coverage accepts engine processed scores plus skipped accounting', async () => {
  const fixture = setup({ sendMessage: message => ({ success: true, data: {
    operationId: message.operationId,
    sourceKey: message.sourceKey,
    processed: 2,
    skipped: 1,
    total: 3,
    complete: true,
    scores: [{ id: 's1', score: 0.9 }, { id: 's2', score: 0.4 }]
  } }) });
  fixture.controller.open();
  const root = fixture.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'partial engine result';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  assert.doesNotMatch(findRole(root, 'status').textContent, /覆盖计数不一致/);
  assert.match(findRole(root, 'progress').textContent, /已处理 2 \/ 3.*部分覆盖/);
});

test('document identity gates painting, focus, and confirmation', async () => {
  const fixture = setup();
  fixture.controller.open();
  const root = fixture.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'identity';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  const rect = { left: 4, top: 8 };
  assert.deepEqual(await fixture.controller.confirm('s1', rect), { saved: true });
  assert.equal(fixture.calls.confirms[0].hit.text, 'Alpha.');
  assert.equal(fixture.calls.confirms[0].hit.score, 0.95);
  assert.equal(fixture.calls.confirms[0].rect, rect);

  fixture.setCurrent(false);
  assert.equal(await fixture.controller.confirm('s2', rect), false);
  assert.equal(fixture.calls.confirms.length, 1);
  assert.match(findRole(root, 'status').textContent, /当前文档已变化/);
  assert.ok(fixture.calls.clears > 0);
});

test('confirmation and model-settings rejections are contained in the controller', async () => {
  const fixture = setup({
    confirm: async () => { throw new Error('anchor unavailable'); },
    openSettings: () => { throw new Error('settings unavailable'); }
  });
  fixture.controller.open();
  const root = fixture.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'error handling';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  assert.equal(await fixture.controller.confirm('s1', {}), false);
  assert.match(findRole(root, 'status').textContent, /anchor unavailable/);
  findRole(root, 'settings').click();
  await flush();
  assert.match(findRole(root, 'status').textContent, /settings unavailable/);
});

test('configuration errors remain understandable and the settings action is task-scoped', async () => {
  const fixture = setup({ sendMessage: () => ({
    success: false,
    error: { code: 'NO_USABLE_PROFILE', message: 'No usable API profile is configured' }
  }) });
  fixture.controller.open();
  const root = fixture.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'query';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  assert.match(findRole(root, 'status').textContent, /TypeSafe Jev/);
  findRole(root, 'settings').click();
  await flush();
  assert.deepEqual(fixture.calls.settings, ['semantic_find']);
  fixture.controller.destroy();
  assert.equal(fixture.document.body.children.length, 0);
});

test('a failed request can be retried with the same query', async () => {
  let attempts = 0;
  const fixture = setup({ sendMessage: message => {
    attempts += 1;
    if (attempts === 1) return {
      success: false,
      error: { code: 'NO_USABLE_PROFILE', message: 'missing profile' }
    };
    return { success: true, data: {
      operationId: message.operationId,
      sourceKey: message.sourceKey,
      processed: 3, skipped: 0, total: 3, complete: true,
      scores: [
        { id: 's1', score: 0.9 }, { id: 's2', score: 0.4 }, { id: 's3', score: 0.2 }
      ]
    } };
  } });
  fixture.controller.open();
  const root = fixture.document.body.children[0];
  const query = findRole(root, 'query');
  query.value = 'retry';
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  assert.match(findRole(root, 'status').textContent, /TypeSafe Jev/);
  fixture.controller.handleKeydown(keyEvent('Enter', query));
  await flush();
  assert.equal(attempts, 2);
  assert.match(findRole(root, 'status').textContent, /找到 1 条/);
});

test('stylesheet is fixed, narrow-screen safe, and deliberately shadow-free', () => {
  const css = readFileSync(join(__dirname, '../semantic-find.css'), 'utf8');
  assert.match(css, /\.sci-semantic-find\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /right:\s*14px/);
  assert.match(css, /width:\s*min\(430px,\s*calc\(100vw - 28px\)\)/);
  assert.match(css, /box-shadow:\s*none/);
  assert.match(css, /rgba\(255,\s*187,\s*35,\s*\.88\)/);
  assert.match(css, /@media\s*\(max-width:\s*460px\)/);
});

test('settings deep link focuses the semantic-find task only after routing rows render', () => {
  const options = readFileSync(join(__dirname, '../options.js'), 'utf8');
  const refresh = options.indexOf('await refreshSettings({ replaceTaskPolicyDrafts: true });');
  const focus = options.indexOf("focusTaskPolicyFromHash({ behavior: 'auto' });");
  assert.ok(refresh >= 0 && focus > refresh);
  assert.match(options, /function taskPolicyIdFromHash\(\)/);
  assert.match(options, /parameters\.get\('task'\)/);
  assert.match(options, /LLM_TASK_IDS\?\.includes\(taskId\)/);
  assert.match(options, /data-task-policy-id="\$\{taskId\}"/);
  assert.match(options, /data-task-policy-profile="\$\{taskId\}"/);
  assert.match(options, /addEventListener\('hashchange',[\s\S]*focusTaskPolicyFromHash/);
});
