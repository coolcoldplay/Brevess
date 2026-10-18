const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source.js');
const selection = require('../core/literature-note-field-selection.js');

const root = path.join(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

class FakeTarget extends EventTarget {
  constructor() {
    super();
    this.disabled = false;
    this.dataset = {};
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
}

function mouseEvent(type, detail) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
}

function keyEvent(key, options = {}) {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    key: { value: key },
    shiftKey: { value: options.shiftKey === true },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false }
  });
  return event;
}

function timerHarness() {
  let sequence = 0;
  const pending = new Map();
  return {
    schedule(callback) {
      const id = ++sequence;
      pending.set(id, callback);
      return id;
    },
    cancel(id) { pending.delete(id); },
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach(callback => callback());
    },
    get size() { return pending.size; }
  };
}

test('field selection defaults selected, toggles by field ID, and isolates notes/templates', () => {
  const store = selection.createLiteratureNoteFieldSelectionStore();
  const fields = [{ id: 'aim' }, { id: 'finding' }, { id: 'limitation' }];
  assert.deepEqual(store.selectedFieldIds('doc\u0000basic', fields),
    ['aim', 'finding', 'limitation']);
  assert.equal(store.toggle('doc\u0000basic', 'finding'), false);
  assert.deepEqual(store.selectedFieldIds('doc\u0000basic', fields),
    ['aim', 'limitation']);
  assert.deepEqual(store.selectedFieldIds('doc\u0000custom', fields),
    ['aim', 'finding', 'limitation']);
  assert.deepEqual(store.selectedFieldIds('other-doc\u0000basic', fields),
    ['aim', 'finding', 'limitation']);
  assert.equal(store.setSelected('doc\u0000basic', 'finding', true), true);
  assert.deepEqual(store.selectedFieldIds('doc\u0000basic', fields),
    ['aim', 'finding', 'limitation']);
});

test('pointer gesture uses a 250-300 ms single-click decision and double click never toggles', () => {
  const target = new FakeTarget();
  const timers = timerHarness();
  let singles = 0;
  let doubles = 0;
  const controller = selection.createDelayedActivationController({
    target,
    schedule: timers.schedule,
    cancelSchedule: timers.cancel,
    onSingle: () => { singles += 1; },
    onDouble: () => { doubles += 1; }
  });
  assert.ok(controller.delay >= 250 && controller.delay <= 300);

  target.dispatchEvent(mouseEvent('click', 1));
  assert.equal(singles, 0);
  timers.flush();
  assert.equal(singles, 1);

  target.dispatchEvent(mouseEvent('click', 1));
  target.dispatchEvent(mouseEvent('click', 2));
  target.dispatchEvent(mouseEvent('dblclick', 2));
  timers.flush();
  assert.equal(singles, 1);
  assert.equal(doubles, 1);

  target.dispatchEvent(keyEvent('Enter'));
  assert.equal(singles, 2);
  target.dispatchEvent(keyEvent('Enter', { shiftKey: true }));
  assert.equal(doubles, 2);
  controller.destroy();
});

test('bottom notes action computes exactly the selected field IDs for batch generation', async () => {
  const store = selection.createLiteratureNoteFieldSelectionStore();
  const template = {
    id: 'custom_note', name: 'Custom', fields: [
      { id: 'aim', label: '目的' },
      { id: 'finding', label: '发现' },
      { id: 'limitation', label: '局限' }
    ]
  };
  const scope = 'doc-key\u0000custom_note';
  store.setSelected(scope, 'finding', false);
  const calls = [];
  const statuses = [];
  const context = vm.createContext({
    literatureNoteDocumentState: { templateId: 'custom_note' },
    literatureNoteTemplates: () => [template],
    literatureNoteFieldSelections: store,
    captureLiteratureNoteContext: () => ({ documentKey: 'doc-key' }),
    capturePanelContext: () => ({ tabId: 7, key: 'doc-key' }),
    isCurrentPanelContext: () => true,
    isCurrentLiteratureNoteContext: () => true,
    document: { getElementById: () => null },
    performSidebarModuleBatch: async (...args) => { calls.push(args); return { ok: true }; },
    showStatus: (...args) => statuses.push(args),
    loadLiteratureNoteDocumentState: async () => undefined,
    t: value => value
  });
  vm.runInContext(
    functionSource(popup, 'literatureNoteFieldSelectionScope') + '\n' +
    functionSource(popup, 'generateSelectedLiteratureNoteFields'),
    context
  );
  await context.generateSelectedLiteratureNoteFields(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'note');
  assert.equal(calls[0][1], true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2].noteFieldIds)),
    ['aim', 'limitation']);

  store.setSelected(scope, 'aim', false);
  store.setSelected(scope, 'limitation', false);
  await context.generateSelectedLiteratureNoteFields(false);
  assert.equal(calls.length, 1);
  assert.match(statuses.at(-1)[0], /至少一个/u);
});

function autofillHarness({ template, builtinTemplate = template }) {
  const messages = [];
  const state = {
    schemaVersion: 3,
    templateId: template.id,
    valuesByTemplate: { [template.id]: {} },
    fieldStatusByTemplate: { [template.id]: {} },
    fieldEvidenceByTemplate: { [template.id]: {} },
    fieldUpdatedAtByTemplate: { [template.id]: {} },
    updatedAt: 1
  };
  const status = {
    textContent: '',
    className: '',
    setAttribute() {}
  };
  const context = vm.createContext({
    structuredClone,
    crypto: { randomUUID: () => 'field-selection-test' },
    Map,
    Set,
    setTimeout: () => 1,
    literatureNoteAutofillPromise: null,
    literatureNotePendingSaveConfirmation: null,
    literatureNoteButtonFeedbackSequence: 0,
    literatureNoteViewRevision: 0,
    literatureNoteDocumentState: state,
    literatureNoteFieldEditVersions: new Map(),
    literatureNoteTemplateSelectionRevision: 0,
    literatureNoteTemplateSelectionBase: { templateId: '', updatedAt: 0 },
    literatureNoteTemplateSelection: null,
    literatureNoteTemplateSelectionConflict: false,
    currentWorkspaceSnapshot: { documentHash: 'a'.repeat(64) },
    preparedDocumentState: null,
    manualAnnotationState: {},
    SciLLM: {
      stableHash: value => JSON.stringify(value),
      normalizeLiteratureNoteTemplates: () => [builtinTemplate]
    },
    document: {
      getElementById(id) {
        if (id === 'literatureNoteStatus') return status;
        return null;
      },
      querySelectorAll: () => []
    },
    requireUsableLlm: () => true,
    literatureNoteTemplates: () => [template],
    captureLiteratureNoteContext: () => ({ documentKey: 'doc-key' }),
    literatureNoteDocumentKey: () => 'doc-key',
    capturePanelContext: () => ({ tabId: 7, key: 'doc-key', pdfMode: false }),
    isCurrentPanelContext: () => true,
    isCurrentLiteratureNoteContext: () => true,
    isSidebarOperationStopping: () => false,
    queryPanelTargetTab: async () => ({ id: 7 }),
    sendTabMessage: async (_tabId, message) => {
      messages.push(JSON.parse(JSON.stringify(message)));
      return {
        success: true,
        result: {
          templateId: template.id,
          documentHash: 'a'.repeat(64),
          cacheHit: false,
          requestedFieldIds: message.requestedFieldIds
        }
      };
    },
    acceptSidebarRuntimeTask: () => true,
    validateLiteratureNoteGenerationReceipt: () => true,
    applyLiteratureNoteAutofillResult: ({ template: appliedTemplate }) => ({
      counts: { filled: appliedTemplate.fields.length, missing: 0, preserved: 0, invalid: 0 },
      changedFields: appliedTemplate.fields.map(field => field.id),
      sourceWarnings: []
    }),
    markLiteratureNoteFieldDirty: () => {},
    updateLiteratureNoteRenderedFields: () => {},
    setLiteratureNotePreview: () => {},
    syncLiteratureNoteTextarea: () => {},
    persistLiteratureNoteDocumentState: async () => ({ stale: false }),
    createLiteratureNoteAutofillSummary: () => ({
      message: '完成', tone: 'success', success: true, buttonLabel: '已保存'
    }),
    formatLlmFailureMessage: (_, error) => error.message,
    renderLiteratureNoteReviewNotice: () => {},
    showStatus: () => {},
    t: value => value
  });
  vm.runInContext(
    functionSource(popup, 'literatureNoteFieldSelectionScope') + '\n' +
    functionSource(popup, 'literatureNoteFieldIsSelected') + '\n' +
    functionSource(popup, 'syncLiteratureNoteFieldSelector') + '\n' +
    popup.slice(
      popup.indexOf('function literatureNoteOperationLabel('),
      popup.indexOf('async function autofillLiteratureNoteFieldWithLLM(')
    ),
    context
  );
  return { context, messages };
}

test('single-field and selected batch requests carry their exact field scopes', async () => {
  const builtin = {
    id: 'basic', name: 'Basic', fields: [
      { id: 'aim', label: '目的' },
      { id: 'finding', label: '发现' },
      { id: 'limitation', label: '局限' }
    ]
  };
  const harness = autofillHarness({ template: builtin });
  await harness.context.autofillLiteratureNoteWithLLM({ fieldId: 'aim' });
  assert.deepEqual(harness.messages.at(-1).requestedFieldIds, ['aim']);
  assert.equal(harness.messages.at(-1).forceRefresh, true);

  await harness.context.autofillLiteratureNoteWithLLM({
    fieldIds: ['finding', 'limitation']
  });
  assert.deepEqual(harness.messages.at(-1).requestedFieldIds,
    ['finding', 'limitation']);
  assert.equal(harness.messages.at(-1).forceRefresh, false);

  const custom = {
    id: 'custom_note', name: 'Custom', fields: [
      { id: 'aim', label: '目的' },
      { id: 'finding', label: '发现' },
      { id: 'limitation', label: '局限' }
    ]
  };
  const customHarness = autofillHarness({ template: custom, builtinTemplate: builtin });
  await customHarness.context.autofillLiteratureNoteWithLLM({
    fieldIds: ['finding', 'limitation']
  });
  const customRequest = customHarness.messages.at(-1);
  assert.deepEqual(customRequest.template.fields.map(field => field.id),
    ['finding', 'limitation']);
  assert.equal(Object.hasOwn(customRequest, 'requestedFieldIds'), false);
});

test('note field UI removes legacy AI buttons and uses one shared outline animation', () => {
  assert.match(html, /core\/literature-note-field-selection\.js/u);
  assert.match(popup, /data-literature-note-field-selector/u);
  assert.match(popup, /aria-pressed/u);
  assert.match(popup, /createDelayedActivationController/u);
  assert.match(popup, /generateSelectedLiteratureNoteFields/u);
  assert.match(popup, /noteFieldIds/u);
  assert.doesNotMatch(popup, /dataset\.generateLiteratureNoteField/u);
  assert.doesNotMatch(popup, /\[data-generate-literature-note-field\]/u);
  assert.doesNotMatch(css, /workspace-soft-pulse/u);
  assert.match(css, /@keyframes navigation-title-work/u);
  assert.match(css, /literature-note-field-selector\.is-running/u);
  assert.match(css, /conic-gradient\(from var\(--navigation-title-angle\)/u);
});
