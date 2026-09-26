const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'options.html'), 'utf8');
const shortcuts = require('../core/keyboard-shortcuts.js');
const taskCatalog = require('../core/llm-task-catalog.js');
const { normalizeTaskTokenRule } = require('../core/token-budget.js');
const { getProviderReasoningCapabilities } = require('../providers/provider-registry.js');

// A small DOM fixture implements tree mutations and selectors used by the real
// options renderers. No profile, prompt, shortcut, or routing renderer is mocked.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {};
    this.id = ''; this.className = ''; this.value = ''; this.checked = false;
    this.disabled = false; this.textContent = ''; this.parentNode = null;
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentNode = null; }); this.children = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => this.className.split(' ').includes(name));
    const data = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (data) { const key = data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return key in this.dataset && (data[2] === undefined || this.dataset[key] === data[2]); }
    return this.tagName.toLowerCase() === selector;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) {
    if (selector.includes(',')) return [...new Set(selector.split(',').flatMap(part => this.querySelectorAll(part.trim())))];
    const parts = selector.trim().split(/\s+/);
    const nodes = this.children.flatMap(node => [node, ...node.querySelectorAll('*')]);
    if (selector === '*') return nodes;
    return nodes.filter(node => {
      if (!node.matches(parts.at(-1))) return false;
      let ancestor = node.parentNode;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (ancestor && !ancestor.matches(parts[i])) ancestor = ancestor.parentNode;
        if (!ancestor) return false;
        ancestor = ancestor.parentNode;
      }
      return true;
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get options() { return this.querySelectorAll('option'); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async dispatch(type, target = this) {
    for (const fn of this.listeners[type] || []) await fn({ target, currentTarget: this, preventDefault() {} });
  }
  focus() {} blur() {} scrollIntoView() {}
}

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function snapshot() {
  return {
    providers: { openai: { label: 'OpenAI', defaultModel: '' }, deepseek: { label: 'DeepSeek', defaultModel: '' }, 'openai-compatible': { label: 'Custom' } },
    settings: {
      profiles: { a: { id: 'a', name: 'Alpha', providerId: 'openai', config: { model: 'saved-a', hasApiKey: true } }, b: { id: 'b', name: 'Beta', providerId: 'deepseek', config: { model: '', hasApiKey: true } } },
      globalProfileId: 'a', mode: 'regex', language: 'zh-CN', autoAnalyze: false, autoCacheFigureImages: true, saveArticleWebSnapshot: true,
      figurePanelFollowupPresets: [{ id: 'panel', name: 'Panel', prompt: 'Saved panel' }],
      articleChatQuickPrompts: [{ id: 'quick', name: 'Quick', prompt: 'Saved quick' }],
      literatureNoteTemplates: [{ id: 'note', name: 'Note', fields: [{ id: 'f', label: 'Field', prompt: 'Saved note' }] }],
      selectionLlmActions: [{ id: 'selection', name: 'Selection', prompt: 'Saved selection', enabled: true }],
      taskPolicies: {}, analysisModes: [], keyboardShortcuts: shortcuts.DEFAULT_KEYBOARD_SHORTCUTS
    }
  };
}
function harness() {
  const body = new Element('body');
  const elements = {};
  const stack = [body];
  const voidTags = new Set(['input', 'meta', 'link', 'br', 'img', 'hr']);
  for (const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/g)) {
    const [, closing, tag, attributes] = match;
    if (closing) {
      const index = stack.findLastIndex(node => node.tagName.toLowerCase() === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const element = new Element(tag);
    element.id = attributes.match(/\bid="([^"]+)"/)?.[1] || '';
    element.className = attributes.match(/\bclass="([^"]+)"/)?.[1] || '';
    element.value = attributes.match(/\bvalue="([^"]*)"/)?.[1] || '';
    element.disabled = /\bdisabled\b/.test(attributes);
    for (const data of attributes.matchAll(/\bdata-([\w-]+)(?:="([^"]*)")?/g)) {
      element.dataset[data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = data[2] || '';
    }
    if (element.id) elements[element.id] = element;
    stack.at(-1).append(element);
    if (!voidTags.has(tag)) stack.push(element);
  }
  const document = {
    body, getElementById: id => elements[id] || null,
    createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('#text'), { textContent: text }),
    querySelectorAll: selector => body.querySelectorAll(selector), querySelector: selector => body.querySelector(selector),
    addEventListener() {}
  };
  const requests = [];
  const context = vm.createContext({ document, console, structuredClone, setTimeout: () => 1, clearTimeout() {},
    URLSearchParams, location: { hash: '', search: '' }, CSS: { escape: value => value },
    window: { addEventListener() {}, confirm: () => true },
    SciLLM: { ...shortcuts, ...taskCatalog, normalizeTaskTokenRule,
      normalizeMineruPdfSettings: () => ({}), setInterfaceLanguage() {},
      LLM_TASK_IDS: ['article_chat'], TASK_DEFINITIONS: [taskCatalog.getLlmTaskDefinition('article_chat')] }
  });
  vm.runInContext(source, context);
  // Non-form overview/category surfaces and external effects are outside this fixture.
  vm.runInContext(`renderSettingsOverview = renderAnalysisModeEditor = renderCustomCategories =
    renderDeletedBuiltInCategories = renderCategoryList = updateUserDataActionButtons = renderOnboarding = () => {};
    requestEndpointPermission = async () => {}; hasUsableApiConfiguration = () => false;`, context);
  context.call = async message => { requests.push(structuredClone(message)); return snapshot(); };
  vm.runInContext('callBackground = message => call(message); bindEvents();', context);
  const run = code => vm.runInContext(code, context);
  context.initial = snapshot(); run('applyState(initial);');
  return { context, document, elements, requests, run,
    update(next = snapshot(), options = {}) { context.next = next; context.options = options; run('applyState(next, options);'); },
    async edit(id, value, type = 'input') { elements[id][typeof value === 'boolean' ? 'checked' : 'value'] = value; await elements[id].dispatch(type); },
    async userEdit(id, value) { if (elements[id].disabled) return false; await this.edit(id, value); return true; },
    async editPrompt(listId, selector, value) { const node = elements[listId].querySelector(selector); assert.ok(node, selector); node.value = value; await elements[listId].dispatch('input', node); return node; },
    switch(id) { context.targetId = id; return elements.apiProfileList.dispatch('click', elements.apiProfileList.querySelector(`[data-profile-id="${id}"]`)); }
  };
}

for (const refresh of ['language', 'shortcuts', 'category']) {
  test(`unrelated ${refresh} save preserves actual dirty profile and prompt DOM`, async () => {
    const h = harness();
    await h.edit('model', 'draft-model'); await h.edit('apiKey', 'draft-key');
    await h.edit('autoAnalyze', true, 'change'); await h.edit('autoCacheFigureImages', false, 'change');
    const prompts = [
      ['panelFollowupPresetList', '[data-panel-preset-prompt]'], ['articleChatQuickPromptList', '[data-quick-prompt-text]'],
      ['literatureNoteTemplateList', '[data-literature-field-prompt]'], ['selectionLlmActionList', '[data-selection-action-prompt]']
    ];
    for (const [list, selector] of prompts) await h.editPrompt(list, selector, `draft-${list}`);
    if (refresh === 'language') await h.edit('globalLanguage', 'en', 'change');
    if (refresh === 'shortcuts') await h.run('saveKeyboardShortcuts()');
    if (refresh === 'category') h.update();
    assert.equal(h.elements.model.value, 'draft-model'); assert.equal(h.elements.apiKey.value, 'draft-key');
    assert.equal(h.elements.autoAnalyze.checked, true); assert.equal(h.elements.autoCacheFigureImages.checked, false);
    for (const [list, selector] of prompts) assert.equal(h.elements[list].querySelector(selector).value, `draft-${list}`);
  });
}
test('dirty profile does not block clean prompt updates and profile switch keeps other domains dirty', async () => {
  const h = harness(); await h.edit('model', 'draft-model');
  const next = snapshot(); next.settings.articleChatQuickPrompts[0].prompt = 'New saved quick'; h.update(next);
  assert.equal(h.elements.articleChatQuickPromptList.querySelector('[data-quick-prompt-text]').value, 'New saved quick');
  await h.editPrompt('articleChatQuickPromptList', '[data-quick-prompt-text]', 'Keep quick');
  await h.switch('b'); h.update();
  assert.equal(h.elements.profileName.value, 'Beta');
  assert.equal(h.elements.articleChatQuickPromptList.querySelector('[data-quick-prompt-text]').value, 'Keep quick');
  assert.equal(h.run('profileEditorDirty'), true);
});
for (const domain of ['model', 'shortcut']) {
  test(`beforeunload protects ${domain} drafts`, async () => {
    const h = harness();
    if (domain === 'model') await h.edit('model', 'draft');
    else h.run('resetKeyboardShortcuts()');
    h.context.event = { preventDefault() { this.prevented = true; } };
    h.run('handleSettingsBeforeUnload(event)'); assert.equal(h.context.event.prevented, true);
  });
}
test('shortcut acknowledgement preserves edits made while saving', async () => {
  const h = harness(); const pending = deferred(); h.context.call = () => pending.promise;
  const input = h.elements.keyboardShortcutGrid.querySelector('[data-shortcut-action]');
  input.value = '8'; await h.elements.keyboardShortcutGrid.dispatch('input', input);
  const saving = h.run('saveKeyboardShortcuts()');
  input.value = '9'; await h.elements.keyboardShortcutGrid.dispatch('input', input);
  pending.resolve(snapshot()); await saving;
  assert.equal(h.elements.keyboardShortcutGrid.querySelector('[data-shortcut-action]').value, '9');
  assert.equal(h.run('keyboardShortcutEditorDirty'), true);
});
test('explicit restored settings replace dirty forms', async () => {
  const h = harness(); await h.edit('model', 'draft'); await h.editPrompt('articleChatQuickPromptList', '[data-quick-prompt-text]', 'draft');
  await h.run('refreshPortableSettings({ replaceTaskPolicyDrafts: true })');
  assert.equal(h.elements.model.value, 'saved-a');
  assert.equal(h.elements.articleChatQuickPromptList.querySelector('[data-quick-prompt-text]').value, 'Saved quick');
  assert.equal(h.run('profileEditorDirty'), false);
});
test('form save submits frozen values and preserves later edits through all three acknowledgements', async () => {
  const h = harness(); await h.edit('model', 'submitted'); await h.edit('autoAnalyze', true, 'change');
  await h.editPrompt('articleChatQuickPromptList', '[data-quick-prompt-text]', 'submitted quick');
  const pending = deferred(); const messages = []; const saved = snapshot();
  h.context.call = async message => {
    messages.push(structuredClone(message));
    if (message.type === 'LLM_SAVE_PROFILE') { await pending.promise; saved.settings.profiles.a.config.model = message.profile.config.model; saved.profile = saved.settings.profiles.a; }
    if (message.type === 'LLM_UPDATE_PREFERENCES') Object.assign(saved.settings, message.preferences);
    return structuredClone(saved);
  };
  const saving = h.run('persistForm(true)'); await Promise.resolve();
  await h.edit('model', 'newer model'); await h.edit('autoAnalyze', false, 'change');
  await h.editPrompt('articleChatQuickPromptList', '[data-quick-prompt-text]', 'newer quick');
  pending.resolve(); await saving;
  assert.equal(messages[0].profile.config.model, 'submitted');
  assert.equal(messages[2].preferences.autoAnalyze, true);
  assert.equal(messages[2].preferences.articleChatQuickPrompts[0].prompt, 'submitted quick');
  assert.equal(h.elements.model.value, 'newer model'); assert.equal(h.elements.autoAnalyze.checked, false);
  assert.equal(h.elements.articleChatQuickPromptList.querySelector('[data-quick-prompt-text]').value, 'newer quick');
  assert.equal(h.run('profileEditorDirty'), true);
});
test('successful unchanged save clears its drafts and refreshes returned saved fields', async () => {
  const h = harness(); await h.edit('model', 'submitted');
  const saved = snapshot(); saved.settings.profiles.a.config.model = 'submitted'; saved.profile = saved.settings.profiles.a;
  h.context.call = async () => structuredClone(saved); await h.run('persistForm(true)');
  assert.equal(h.elements.model.value, 'submitted'); assert.equal(h.run('profileEditorDirty'), false);
});
test('form save failure keeps newer routing selection for retry', async () => {
  const h = harness(); const pending = deferred(); await h.edit('globalProfileId', 'a', 'change');
  h.context.call = async message => { if (message.type === 'LLM_SAVE_PROFILE') return snapshot(); return pending.promise; };
  const saving = h.run('persistForm(true)'); await Promise.resolve(); await Promise.resolve();
  await h.edit('globalProfileId', 'b', 'change'); pending.reject(new Error('routing rejected'));
  await assert.rejects(saving, /routing rejected/);
  assert.equal(h.elements.globalProfileId.value, 'b'); assert.equal(h.run('profileEditorDirty'), true);
});
test('delayed discovery caches A results without touching the selected B model, dropdown or status', async () => {
  const h = harness(); const pending = deferred(); h.context.call = () => pending.promise;
  const discovery = h.run('refreshProviderModels()'); await h.switch('b');
  const status = h.elements.modelDiscoveryStatus.textContent;
  pending.resolve({ models: [{ id: 'only-a' }] }); await discovery;
  assert.equal(h.elements.model.value, ''); assert.equal(h.elements.modelDiscoveryStatus.textContent, status);
  assert.equal(h.elements.modelSuggestionsSelect.options.some(item => item.value === 'only-a'), false);
  assert.equal(h.run("discoveredModels.get('a|openai|').models[0].id"), 'only-a');
});
test('a new provider discovery owns loading until its response, ignoring the old finally', async () => {
  const h = harness(); const pendingA = deferred(); const pendingB = deferred(); const requests = [];
  h.context.call = message => { requests.push(message); return message.profileId === 'a' ? pendingA.promise : pendingB.promise; };
  const a = h.run('refreshProviderModels()'); await h.switch('b'); const b = h.run('refreshProviderModels()');
  assert.equal(requests.length, 2);
  pendingA.resolve({ models: [{ id: 'a-only' }] }); await a;
  assert.equal(h.elements.refreshModels.disabled, true); assert.equal(h.elements.modelDiscoveryStatus.dataset.state, 'loading');
  pendingB.resolve({ models: [{ id: 'b-only' }] }); await b;
  assert.equal(h.elements.model.value, 'b-only'); assert.equal(h.elements.refreshModels.disabled, false);
});
test('provider changes invalidate same-profile discovery responses', async () => {
  const h = harness(); const pending = deferred(); h.context.call = () => pending.promise;
  const request = h.run('refreshProviderModels()'); await h.edit('providerId', 'deepseek', 'change');
  pending.resolve({ models: [{ id: 'wrong-provider' }] }); await request;
  assert.equal(h.elements.model.value, ''); assert.equal(h.elements.modelSuggestionsSelect.options.some(item => item.value === 'wrong-provider'), false);
});
test('delayed profile rename updates its original entity without clearing B drafts', async () => {
  const h = harness(); const pending = deferred(); h.context.call = () => pending.promise;
  await h.edit('profileName', 'Alpha saved'); const rename = h.run('persistProfileName()');
  await h.switch('b'); await h.edit('profileName', 'Beta draft');
  pending.resolve({ profile: { id: 'a', name: 'Alpha saved' } }); await rename;
  assert.equal(h.run('state.settings.profiles.a.name'), 'Alpha saved'); assert.equal(h.run('state.settings.profiles.b.name'), 'Beta');
  assert.equal(h.elements.profileName.value, 'Beta draft'); assert.equal(h.run("profileDirtyFields.has('profileName')"), true);
});
test('profile rename acknowledgement preserves a newer same-profile draft', async () => {
  const h = harness(); const pending = deferred(); h.context.call = () => pending.promise;
  await h.edit('profileName', 'Submitted'); const rename = h.run('persistProfileName()'); await h.edit('profileName', 'Newer');
  pending.resolve({ profile: { id: 'a', name: 'Submitted' } }); await rename;
  assert.equal(h.run('state.settings.profiles.a.name'), 'Submitted'); assert.equal(h.elements.profileName.value, 'Newer');
  assert.equal(h.run("profileDirtyFields.has('profileName')"), true);
  assert.match(h.elements.apiProfileList.querySelector('[data-profile-id="a"]').textContent, /Newer/);
});
test('profile rename failure preserves draft and dirty state for retry', async () => {
  const h = harness(); h.context.call = async () => { throw new Error('rename rejected'); };
  await h.edit('profileName', 'Retry name'); await h.run('persistProfileName()');
  assert.equal(h.elements.profileName.value, 'Retry name'); assert.equal(h.run('state.settings.profiles.a.name'), 'Alpha');
  assert.equal(h.run("profileDirtyFields.has('profileName')"), true); assert.match(h.elements.status.textContent, /rename rejected/);
});

test('profile duplication preserves unrelated prompt dirty ownership on later refresh', async () => {
  const h = harness(); await h.editPrompt('articleChatQuickPromptList', '[data-quick-prompt-text]', 'Keep draft');
  const result = snapshot(); result.settings.profiles.c = { ...result.settings.profiles.a, id: 'c', name: 'Copy' }; result.profile = result.settings.profiles.c;
  h.context.call = async () => structuredClone(result); await h.run('duplicateApiProfile()'); h.update(result);
  assert.equal(h.elements.articleChatQuickPromptList.querySelector('[data-quick-prompt-text]').value, 'Keep draft');
  assert.equal(h.run('profileEditorDirty'), true);
});
test('saving A does not select it again or acknowledge drafts subsequently entered in B', async () => {
  const h = harness(); await h.edit('model', 'submit-a'); const pending = deferred(); const result = snapshot(); result.profile = result.settings.profiles.a;
  h.context.call = async message => { if (message.type === 'LLM_SAVE_PROFILE') await pending.promise; return structuredClone(result); };
  const saving = h.run('persistForm(true)'); await Promise.resolve(); await h.switch('b'); await h.edit('model', 'new-b');
  pending.resolve(); const receipt = await saving;
  assert.equal(receipt.profileId, 'a'); assert.equal(h.run('selectedProfileId'), 'b'); assert.equal(h.elements.model.value, 'new-b');
  assert.equal(h.run('profileEditorDirty'), true);
});
test('older discovery errors do not replace the current success status', async () => {
  const h = harness(); const a = deferred(); const b = deferred();
  h.context.call = message => message.profileId === 'a' ? a.promise : b.promise;
  const first = h.run('refreshProviderModels()'); await h.switch('b'); const second = h.run('refreshProviderModels()');
  b.resolve({ models: [{ id: 'correct-b' }] }); await second; const status = h.elements.modelDiscoveryStatus.textContent;
  a.reject(new Error('stale provider failure')); await first;
  assert.equal(h.elements.modelDiscoveryStatus.textContent, status); assert.equal(h.elements.model.value, 'correct-b');
});
test('returning to A cannot let its first request overwrite the newer discovery cache', async () => {
  const h = harness(); const old = deferred(); const fresh = deferred(); let count = 0;
  h.context.call = () => ++count === 1 ? old.promise : fresh.promise;
  const first = h.run('refreshProviderModels()'); await h.switch('b'); await h.switch('a'); const second = h.run('refreshProviderModels()');
  fresh.resolve({ models: [{ id: 'fresh-a' }] }); await second;
  old.resolve({ models: [{ id: 'stale-a' }] }); await first;
  assert.equal(h.run("discoveredModels.get('a|openai|').models[0].id"), 'fresh-a');
  assert.equal(h.elements.modelSuggestionsSelect.options.some(item => item.value === 'stale-a'), false);
});

test('task-policy DOM changes made during saving retain their routing and token draft', async () => {
  const h = harness(); const pending = deferred(); const result = snapshot(); result.profile = result.settings.profiles.a;
  h.context.call = async message => { if (message.type === 'LLM_SAVE_PROFILE') await pending.promise; return structuredClone(result); };
  const saving = h.run('persistForm(true)'); await Promise.resolve();
  const select = h.elements.llmTaskPolicyTableBody.querySelector('[data-task-policy-profile="article_chat"]');
  select.value = 'b'; await h.elements.llmTaskPolicyTableBody.dispatch('change', select);
  h.run("taskPolicyDraft('article_chat').tokenRule = { input: { reservedTokens: 2048 }, output: { floor: 4096 } }; markProfileEditorDirty('taskTokenRuleDialog');");
  pending.resolve(); await saving;
  assert.equal(h.elements.llmTaskPolicyTableBody.querySelector('[data-task-policy-profile="article_chat"]').value, 'b');
  assert.equal(h.run("taskPolicyDraft('article_chat').tokenRule.output.floor"), 4096);
  assert.equal(h.run('profileEditorDirty'), true);
});

for (const action of ['addApiProfile', 'duplicateApiProfile', 'deleteApiProfile']) {
  test(`${action} locks profile/routing input while pending and displays the returned owner`, async () => {
    const h = harness(); const pending = deferred(); h.context.call = () => pending.promise;
    h.elements.testProvider.disabled = true;
    const changing = h.run(`${action}()`);
    assert.equal(h.elements.model.disabled, true); assert.equal(h.elements.profileName.disabled, true);
    assert.equal(h.elements.globalProfileId.disabled, true);
    assert.equal(h.elements.llmTaskPolicyTableBody.querySelector('[data-task-policy-profile="article_chat"]').disabled, true);
    assert.equal(await h.userEdit('model', 'wrong-owner-draft'), false);
    const result = snapshot(); const targetId = action === 'deleteApiProfile' ? 'b' : 'c';
    result.settings.profiles[targetId] = { id: targetId, name: 'Returned profile', providerId: 'openai', config: { model: 'returned-model' } };
    result.profile = result.settings.profiles[targetId];
    if (action === 'deleteApiProfile') { delete result.settings.profiles.a; result.settings.globalProfileId = targetId; }
    pending.resolve(result); await changing;
    assert.equal(h.run('selectedProfileId'), targetId); assert.equal(h.elements.model.value, 'returned-model');
    assert.equal(h.elements.model.disabled, false); assert.equal(h.elements.testProvider.disabled, true);
    assert.equal(h.run('profileEditorDirty'), false);
  });
  test(`${action} failure restores prior disabled states and leaves the original editor owned by A`, async () => {
    const h = harness(); const pending = deferred(); h.context.call = () => pending.promise;
    h.elements.baseUrl.disabled = true; const changing = h.run(`${action}()`);
    assert.equal(h.elements.model.disabled, true);
    pending.reject(new Error('mutation rejected')); await changing;
    assert.equal(h.run('selectedProfileId'), 'a'); assert.equal(h.elements.model.value, 'saved-a');
    assert.equal(h.elements.model.disabled, false); assert.equal(h.elements.baseUrl.disabled, true);
    assert.equal(await h.userEdit('model', 'retry edit'), true); assert.equal(h.run('profileEditorDirty'), true);
    assert.match(h.elements.status.textContent, /mutation rejected/);
  });
}
test('unrelated refreshes cannot unlock recreated task controls during a profile mutation', async () => {
  const h = harness(); const pending = deferred(); h.context.call = () => pending.promise;
  const changing = h.run('duplicateApiProfile()'); h.update();
  assert.equal(h.elements.model.disabled, true);
  assert.equal(h.elements.llmTaskPolicyTableBody.querySelector('[data-task-policy-profile="article_chat"]').disabled, true);
  pending.reject(new Error('mutation rejected')); await changing;
  assert.equal(h.elements.llmTaskPolicyTableBody.querySelector('[data-task-policy-profile="article_chat"]').disabled, false);
});
test('model discovery cannot write profile drafts or unlock controls while a structural mutation is pending', async () => {
  const h = harness(); h.elements.model.value = ''; const discovery = deferred(); const mutation = deferred();
  h.context.call = message => message.type === 'LLM_LIST_MODELS' ? discovery.promise : mutation.promise;
  const discovering = h.run('refreshProviderModels()'); const changing = h.run('duplicateApiProfile()');
  discovery.resolve({ models: [{ id: 'late-a' }] }); await discovering;
  assert.equal(h.elements.model.value, ''); assert.equal(h.run('profileEditorDirty'), false);
  assert.equal(h.elements.refreshModels.disabled, true);
  mutation.reject(new Error('mutation rejected')); await changing;
  assert.equal(h.elements.refreshModels.disabled, false);
});

test('main save reports newer unsaved edits after acknowledging the submitted draft', async () => {
  const h = harness(); await h.edit('model', 'submitted'); const pending = deferred();
  h.context.call = async message => { if (message.type === 'LLM_SAVE_PROFILE') await pending.promise; return snapshot(); };
  const saving = h.run('persistForm(false)'); await Promise.resolve(); await h.edit('model', 'newer');
  pending.resolve(); await saving;
  assert.match(h.elements.status.textContent, /仍有未保存/); assert.equal(h.run('profileEditorDirty'), true);
});
test('shortcut save reports newer unsaved shortcuts after acknowledging the submitted draft', async () => {
  const h = harness(); const pending = deferred(); h.context.call = () => pending.promise;
  const saving = h.run('saveKeyboardShortcuts()');
  const input = h.elements.keyboardShortcutGrid.querySelector('[data-shortcut-action]');
  input.value = '9'; await h.elements.keyboardShortcutGrid.dispatch('input', input);
  pending.resolve(snapshot()); await saving;
  assert.match(h.elements.keyboardShortcutStatus.textContent, /仍有未保存/);
});

for (const oldHasModels of [false, true]) {
  test(`deleting A recomputes B model-candidate availability when A had ${oldHasModels ? 'models' : 'no models'}`, async () => {
    const h = harness(); const initial = snapshot(); initial.settings.profiles.a.config.model = oldHasModels ? 'old-model' : '';
    initial.settings.profiles.b.config.model = oldHasModels ? '' : 'new-model'; h.update(initial);
    assert.equal(h.elements.modelSuggestionsSelect.disabled, !oldHasModels);
    const result = structuredClone(initial); delete result.settings.profiles.a; result.settings.globalProfileId = 'b';
    h.context.call = async () => result; await h.run('deleteApiProfile()');
    assert.equal(h.run('selectedProfileId'), 'b');
    assert.equal(h.elements.modelSuggestionsSelect.disabled, oldHasModels);
  });
}
for (const oldSupportsReasoning of [false, true]) {
  test(`deleting A recomputes B reasoning-probe availability when A support was ${oldSupportsReasoning}`, async () => {
    const h = harness(); h.context.SciLLM.getProviderReasoningCapabilities = getProviderReasoningCapabilities;
    const initial = snapshot();
    for (const [id, supported] of [['a', oldSupportsReasoning], ['b', !oldSupportsReasoning]]) {
      initial.settings.profiles[id].providerId = supported ? 'deepseek' : 'openai';
      initial.settings.profiles[id].config.model = supported ? 'deepseek-v4-pro' : 'gpt-4o';
    }
    h.update(initial); assert.equal(h.elements.testReasoningStructured.disabled, !oldSupportsReasoning);
    const result = structuredClone(initial); delete result.settings.profiles.a; result.settings.globalProfileId = 'b';
    h.context.call = async () => result; await h.run('deleteApiProfile()');
    assert.equal(h.run('selectedProfileId'), 'b');
    assert.equal(h.elements.testReasoningStructured.disabled, oldSupportsReasoning);
  });
}
test('failed structural mutation restores old dynamic disabled states without changing profile', async () => {
  const h = harness(); h.context.SciLLM.getProviderReasoningCapabilities = getProviderReasoningCapabilities;
  const initial = snapshot(); initial.settings.profiles.a.providerId = 'deepseek'; initial.settings.profiles.a.config.model = 'deepseek-v4-pro'; h.update(initial);
  const oldModelsDisabled = h.elements.modelSuggestionsSelect.disabled;
  const oldReasoningDisabled = h.elements.testReasoningStructured.disabled;
  h.context.call = async () => { throw new Error('delete rejected'); }; await h.run('deleteApiProfile()');
  assert.equal(h.run('selectedProfileId'), 'a');
  assert.equal(h.elements.modelSuggestionsSelect.disabled, oldModelsDisabled);
  assert.equal(h.elements.testReasoningStructured.disabled, oldReasoningDisabled);
});

test('successive explicit name blurs serialize the latest intent and do not save later unblurred input', async () => {
  const h = harness(); const first = deferred(); const messages = [];
  h.context.call = async message => { messages.push(structuredClone(message)); if (messages.length === 1) await first.promise; return { profile: { ...message.profile } }; };
  await h.edit('profileName', 'First'); const saving = h.run('persistProfileName()');
  await h.edit('profileName', 'Replaced queued'); const replaced = h.run('persistProfileName()');
  await h.edit('profileName', 'Last blurred'); const last = h.run('persistProfileName()');
  await h.edit('profileName', 'Not blurred');
  first.resolve(); await Promise.all([saving, replaced, last]);
  assert.deepEqual(messages.map(message => message.profile.name), ['First', 'Last blurred']);
  assert.equal(h.run('state.settings.profiles.a.name'), 'Last blurred');
  assert.equal(h.elements.profileName.value, 'Not blurred'); assert.equal(h.run("profileDirtyFields.has('profileName')"), true);
});
test('an explicit B name blur is queued behind an A rename and persists under B owner', async () => {
  const h = harness(); const first = deferred(); const messages = [];
  h.context.call = async message => { messages.push(structuredClone(message)); if (messages.length === 1) await first.promise; return { profile: { ...message.profile } }; };
  await h.edit('profileName', 'Alpha renamed'); const a = h.run('persistProfileName()');
  await h.switch('b'); await h.edit('profileName', 'Beta renamed'); const b = h.run('persistProfileName()');
  first.resolve(); await Promise.all([a, b]);
  assert.deepEqual(messages.map(message => message.profile), [{ id: 'a', name: 'Alpha renamed' }, { id: 'b', name: 'Beta renamed' }]);
  assert.equal(h.run('state.settings.profiles.a.name'), 'Alpha renamed'); assert.equal(h.run('state.settings.profiles.b.name'), 'Beta renamed');
  assert.equal(h.elements.profileName.value, 'Beta renamed'); assert.equal(h.run("profileDirtyFields.has('profileName')"), false);
});
test('explicitly reverting to the original saved name while rename is pending persists the revert', async () => {
  const h = harness(); const first = deferred(); const messages = [];
  h.context.call = async message => { messages.push(structuredClone(message)); if (messages.length === 1) await first.promise; return { profile: { ...message.profile } }; };
  await h.edit('profileName', 'New'); const firstSave = h.run('persistProfileName()');
  await h.edit('profileName', 'Alpha'); const revert = h.run('persistProfileName()');
  first.resolve(); await Promise.all([firstSave, revert]);
  assert.deepEqual(messages.map(message => message.profile.name), ['New', 'Alpha']);
  assert.equal(h.run('state.settings.profiles.a.name'), 'Alpha'); assert.equal(h.elements.profileName.value, 'Alpha');
  assert.equal(h.run("profileDirtyFields.has('profileName')"), false);
});
test('a queued rename failure keeps its latest draft retryable and releases the serial action', async () => {
  const h = harness(); const first = deferred(); const messages = [];
  h.context.call = async message => {
    messages.push(structuredClone(message)); if (messages.length === 1) await first.promise;
    if (messages.length === 2) throw new Error('queued rename rejected');
    return { profile: { ...message.profile } };
  };
  await h.edit('profileName', 'First'); const firstSave = h.run('persistProfileName()');
  await h.edit('profileName', 'Retry queued'); const queued = h.run('persistProfileName()');
  first.resolve(); await Promise.all([firstSave, queued]);
  assert.equal(messages.length, 2); assert.equal(h.elements.profileName.value, 'Retry queued');
  assert.equal(h.run("profileDirtyFields.has('profileName')"), true); assert.match(h.elements.status.textContent, /queued rename rejected/);
  await h.run('persistProfileName()');
  assert.equal(messages.length, 3); assert.equal(h.run('state.settings.profiles.a.name'), 'Retry queued');
  assert.equal(h.run("profileDirtyFields.has('profileName')"), false);
});

test('external deletion of dirty A keeps its draft owned by A and blocks a save into B', async () => {
  const h = harness(); await h.edit('model', 'draft-a-model'); await h.edit('apiKey', 'draft-a-key');
  const next = snapshot(); delete next.settings.profiles.a; next.settings.globalProfileId = 'b'; h.update(next);
  const receipt = await h.run('persistForm(false)');
  assert.equal(h.requests.length, 0); assert.equal(receipt, null);
  assert.equal(h.run('selectedProfileId'), 'a'); assert.equal(h.elements.model.value, 'draft-a-model');
  assert.equal(h.elements.apiKey.value, 'draft-a-key'); assert.equal(h.run('profileEditorDirty'), true);
  assert.match(h.elements.status.textContent, /其他窗口删除/); assert.match(h.elements.status.textContent, /草稿.*保留/);
  h.run('renderProfileEditor()');
  assert.equal(h.run('selectedProfileId'), 'a'); assert.equal(h.elements.model.value, 'draft-a-model');
  assert.throws(() => h.run('collectProfile()'), /其他窗口删除/);
});
test('a deleted final profile keeps its dirty form until an explicit discard', async () => {
  const h = harness(); await h.edit('model', 'only-draft');
  const next = snapshot(); next.settings.profiles = {}; next.settings.globalProfileId = ''; h.update(next);
  h.run('renderProfileEditor()'); await h.run('persistForm(false)');
  assert.equal(h.run('selectedProfileId'), 'a'); assert.equal(h.elements.model.value, 'only-draft');
  assert.equal(h.requests.length, 0); assert.equal(h.run('profileEditorDirty'), true);
});
test('switching away from an externally deleted profile requires the existing explicit discard confirmation', async () => {
  const h = harness(); await h.edit('model', 'draft-a');
  const next = snapshot(); delete next.settings.profiles.a; next.settings.globalProfileId = 'b'; h.update(next);
  h.context.window.confirm = () => false; await h.switch('b');
  assert.equal(h.run('selectedProfileId'), 'a'); assert.equal(h.elements.model.value, 'draft-a');
  h.context.window.confirm = () => true; await h.switch('b');
  assert.equal(h.run('selectedProfileId'), 'b'); assert.equal(h.elements.profileName.value, 'Beta');
  assert.equal(h.elements.model.value, ''); assert.equal(h.run('profileEditorDirty'), false);
});
test('external deletion of a clean selected profile still renders the valid fallback profile', () => {
  const h = harness(); const next = snapshot(); delete next.settings.profiles.a; next.settings.globalProfileId = 'b'; h.update(next);
  assert.equal(h.run('selectedProfileId'), 'b'); assert.equal(h.elements.profileName.value, 'Beta');
  assert.equal(h.run('profileEditorDirty'), false);
});
test('external deletion during endpoint permission waiting stops the captured missing-profile save', async () => {
  const h = harness(); await h.edit('model', 'draft-a'); const permission = deferred();
  h.context.waitPermission = () => permission.promise; h.run('requestEndpointPermission = waitPermission;');
  const saving = h.run('persistForm(false)');
  const next = snapshot(); delete next.settings.profiles.a; next.settings.globalProfileId = 'b'; h.update(next);
  permission.resolve(); const result = await saving;
  assert.equal(result, null); assert.equal(h.requests.length, 0); assert.equal(h.run('selectedProfileId'), 'a');
  assert.equal(h.elements.model.value, 'draft-a'); assert.equal(h.run('profileEditorDirty'), true);
});
