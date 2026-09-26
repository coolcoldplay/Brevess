const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SciLLM = require('../core/reading-tools.js');
const { createBackgroundRouter } = require('../core/background-router.js');

const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
const clone = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
const runtimeExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
const runtimeBaseUrl = `chrome-extension://${runtimeExtensionId}/`;
const sender = { senderExtensionId: runtimeExtensionId, runtimeBaseUrl,
  senderUrl: `${runtimeBaseUrl}popup.html` };
const noteKey = 'sciLiteratureNotesV1';
function note(templateId = 'template_a', updatedAt = 10) {
  return { schemaVersion: 3, templateId, updatedAt,
    valuesByTemplate: { template_a: { finding: 'original' } },
    fieldStatusByTemplate: {}, fieldEvidenceByTemplate: {},
    fieldUpdatedAtByTemplate: { template_a: { finding: 10 } } };
}
function fixture(initial = note()) {
  const values = { [noteKey]: { schemaVersion: 3, entries: { paper: clone(initial) } } };
  let writes = 0;
  let failWrite = false;
  const storageArea = {
    get(key, done) { done({ [key]: clone(values[key]) }); },
    set(input, done) {
      if (failWrite) throw new Error('private storage failure');
      writes += 1; Object.assign(values, clone(input)); done();
    }
  };
  const router = createBackgroundRouter({ storageArea, runtimeExtensionId,
    cacheStore: {}, corpusStore: {}, documentStore: {}, nowImpl: () => 10,
    fetchImpl: async () => { throw new Error('network forbidden'); } });
  return {
    values, router, get writes() { return writes; },
    fail(value) { failWrite = value; },
    state() { return clone(values[noteKey].entries.paper); },
    send(delta) { return router.handle({ type: 'LITERATURE_NOTE_COMMIT_DELTA',
      documentKey: 'paper', delta }, sender); }
  };
}
const selection = (templateId, baseTemplateId = 'template_a', baseUpdatedAt = 10) =>
  ({ mode: 'set', expectedTemplateId: baseTemplateId, expectedUpdatedAt: baseUpdatedAt });
const delta = (control, fields = [], templateId = 'template_b') => ({ templateId,
  fields, ...(control === undefined ? {} : { templateSelection: control }) });
const body = (value = 'new body', revision = 1) => ({
  key: 'template_a\u0000finding', templateId: 'template_a', fieldId: 'finding',
  value, status: null, revision
});
function helpers() {
  const context = { SciLLM };
  const start = source.indexOf('// DOM-independent popup UI helpers: start');
  const end = source.indexOf('// DOM-independent popup UI helpers: end');
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end) + '\nglobalThis.helpers = PopupUiHelpers;', context);
  return context.helpers;
}
function mergeState(saved, live, dirty) {
  const start = source.indexOf('function mergeLiteratureNoteDocumentState(');
  const end = source.indexOf('\nfunction literatureNoteTemplates(', start);
  assert.ok(start >= 0 && end > start);
  return Function('normalizeLiteratureNoteDocumentState',
    source.slice(start, end) + ';return mergeLiteratureNoteDocumentState;')(
    SciLLM.normalizeLiteratureNoteDocumentState)(saved && plain(saved), live && plain(live), dirty);
}
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; });
  return { resolve, promise }; };
function client(h = fixture(), options = {}) {
  let state = h.state();
  let base = { templateId: state.templateId, updatedAt: state.updatedAt };
  let intent = null; let revision = 0; let current = 'paper';
  const dirty = new Map(); const sent = [];
  const coordinator = helpers().createLiteratureNotePersistenceCoordinator({
    clone, merge: mergeState, contextKey: context => context.id,
    getState: () => state, setState: value => { state = value; },
    getDirtyRevisions: () => dirty,
    clearDirtyRevision: (key, rev) => { if (dirty.get(key) === rev) dirty.delete(key); },
    getTemplateSelection: () => intent,
    clearTemplateSelection: rev => { if (intent?.revision === rev) intent = null; },
    acceptTemplateSelectionAck: (before, after) => {
      if (base.templateId === before.templateId && base.updatedAt === before.updatedAt) {
        base = clone(after);
      }
      if (intent?.expectedTemplateId === before.templateId &&
          intent.expectedUpdatedAt === before.updatedAt) {
        intent.expectedTemplateId = after.templateId;
        intent.expectedUpdatedAt = after.updatedAt;
      }
    },
    isCurrent: context => context.id === current,
    ...options
  });
  async function commit(payload) {
    sent.push(plain(payload.delta));
    const response = await h.send(plain(payload.delta));
    if (!response.success) {
      throw Object.assign(new Error(response.error.code), { code: response.error.code });
    }
    return { state: response.data.state, localState: response.data.state,
      templateSelectionBase: response.data.templateSelectionBase,
      localPendingDelta: delta({ mode: 'preserve' }, [], response.data.state.templateId || payload.delta.templateId),
      clearDirty: true };
  }
  return { h, coordinator, sent, commit, dirty,
    get state() { return state; }, get intent() { return intent; }, get base() { return base; },
    select(id) {
      state.templateId = id;
      intent = { ...selection(id, base.templateId, base.updatedAt), templateId: id,
        revision: ++revision };
    },
    edit(value) { state.valuesByTemplate.template_a.finding = value;
      state.fieldUpdatedAtByTemplate.template_a.finding += 1;
      dirty.set('template_a\u0000finding', ++revision); },
    save(operation = commit) { return coordinator.save(operation, { id: current }); },
    leave() { current = 'other'; state = note('template_other'); intent = null; dirty.clear(); },
    reopen() {
      current = 'paper'; state = h.state();
      base = { templateId: state.templateId, updatedAt: state.updatedAt };
      const retry = coordinator.getRetrySnapshot({ id: current });
      if (retry) {
        const overlay = helpers().applyLiteratureNoteRetryOverlay({ resolvedState: state,
          retry, merge: mergeState });
        state = overlay.state; intent = overlay.templateSelection || null;
        overlay.dirtyRevisions.forEach((value, key) => dirty.set(key, value));
      }
    }
  };
}

// Real popup coordinator, load/save wrapper and router; only browser storage,
// context and presentation boundaries are replaced with deterministic adapters.
function runtime(h = fixture(), workspace = null) {
  let current = 'paper'; const status = { textContent: '' }; const notices = [];
  const timers = []; const sent = [];
  const context = { ...helpers(), SciLLM, structuredClone, console,
    preparedDocumentState: null, llmSettingsState: {},
    t: value => value,
    captureLiteratureNoteContext: () => ({ id: current, documentKey: current, legacyKey: '', target: null }),
    isCurrentLiteratureNoteContext: saved => saved.id === current,
    normalizeLiteratureNoteDocumentState: SciLLM.normalizeLiteratureNoteDocumentState,
    mergeLiteratureNoteDocumentState: mergeState,
    readLiteratureNoteWorkspaceState: async () => workspace ? { state: clone(workspace) } : null,
    document: { getElementById: id => id === 'literatureNoteStatus' ? status : null },
    renderLiteratureNoteDrawer() {},
    showStatus: (...args) => notices.push(args),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    sendLlmMessage: async () => ({}),
    chrome: { storage: { local: { get: async key => ({ [key]: clone(h.values[key]) }) } },
      runtime: { sendMessage: async message => {
        sent.push(plain(message)); return h.send(plain(message.delta));
      } } }
  };
  const globalsStart = source.indexOf("const LITERATURE_NOTE_STORAGE_KEY =");
  const globalsEnd = source.indexOf('let workspaceGeneration', globalsStart);
  const functionsStart = source.indexOf('async function loadLiteratureNoteDocumentState(');
  const functionsEnd = source.indexOf('\nfunction formatLlmFailureMessage(', functionsStart);
  assert.ok(globalsStart >= 0 && globalsEnd > globalsStart &&
    functionsStart >= 0 && functionsEnd > functionsStart);
  vm.runInNewContext(source.slice(globalsStart, globalsEnd) + '\n' +
    source.slice(functionsStart, functionsEnd) + `
      globalThis.api = {
        load: loadLiteratureNoteDocumentState,
        persist: persistLiteratureNoteDocumentState,
        reserve: reserveLiteratureNoteDocumentStatePersistence,
        display(templateId) { literatureNoteDocumentState.templateId = templateId; },
        edit(value, initializeTemplate = true) {
          literatureNoteDocumentState.valuesByTemplate.template_a ||= {};
          literatureNoteDocumentState.valuesByTemplate.template_a.finding = value;
          markLiteratureNoteFieldDirty('template_a\\u0000finding', { initializeTemplate });
        },
        change: typeof handleLiteratureNoteTemplateChange === 'function'
          ? handleLiteratureNoteTemplateChange : null,
        coordinator: literatureNotePersistenceCoordinator,
        get state() { return literatureNoteDocumentState; },
        get selection() { return typeof literatureNoteTemplateSelection === 'undefined'
          ? null : literatureNoteTemplateSelection; },
        get base() { return typeof literatureNoteTemplateSelectionBase === 'undefined'
          ? null : literatureNoteTemplateSelectionBase; }
      };`, context);
  return { h, status, notices, timers, sent, context, api: context.api,
    leave() { current = 'other'; }, enter() { current = 'paper'; } };
}

test('legacy empty fields stays read-only and has no new ACK properties', async () => {
  const h = fixture();
  const response = await h.send(delta(undefined));
  assert.equal(response.success, true);
  assert.equal(h.writes, 0);
  assert.equal(response.data.state.templateId, 'template_a');
  assert.deepEqual(Object.keys(response.data).sort(), ['saved', 'state']);
});

test('legacy explicit field-clock writes retain their old document timestamp calculation', async () => {
  const h = fixture(note('template_a', 100));
  const response = await h.send(delta(undefined, [{ ...body(), fieldUpdatedAt: 20 }]));
  assert.equal(response.success, true);
  assert.equal(response.data.state.updatedAt, 20);
  assert.equal(response.data.state.templateId, 'template_b');
  assert.equal(Object.hasOwn(response.data, 'templateSelectionBase'), false);
});

test('explicit metadata-only selection writes atomically and returns the before tuple', async () => {
  const h = fixture();
  const response = await h.send(delta(selection('template_b')));
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(h.state().templateId, 'template_b');
  assert.equal(h.state().updatedAt, 11);
  assert.equal(h.writes, 1);
  assert.deepEqual(response.data.templateSelectionBase,
    { templateId: 'template_a', updatedAt: 10 });
  assert.equal(h.state().valuesByTemplate.template_a.finding, 'original');
});

test('explicit preserve body update does not overwrite a different saved template', async () => {
  const h = fixture(note('template_c'));
  const response = await h.send(delta({ mode: 'preserve' }, [body()]));
  assert.equal(response.success, true);
  assert.equal(h.state().templateId, 'template_c');
  assert.ok(h.state().updatedAt > 10);
  assert.deepEqual(response.data.templateSelectionBase,
    { templateId: 'template_c', updatedAt: 10 });
});

test('metadata CAS rejects stale external and same-millisecond ABA without body writes', async () => {
  const h = fixture();
  await h.send(delta(selection('template_b')));
  await h.send(delta(selection('template_a', 'template_b', 11), [], 'template_a'));
  const response = await h.send(delta(selection('template_c'), [body()]));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'LITERATURE_NOTE_TEMPLATE_CONFLICT');
  assert.equal(h.state().templateId, 'template_a');
  assert.equal(h.state().updatedAt, 12);
  assert.equal(h.state().valuesByTemplate.template_a.finding, 'original');
});

test('two concurrent controlled selections with the same base produce exactly one write', async () => {
  const h = fixture();
  const responses = await Promise.all([
    h.send(delta(selection('template_b'))),
    h.send(delta(selection('template_c'), [], 'template_c'))
  ]);
  assert.equal(responses.filter(response => response.success).length, 1);
  assert.equal(responses.find(response => !response.success).error.code,
    'LITERATURE_NOTE_TEMPLATE_CONFLICT');
  assert.equal(h.writes, 1);
});

test('explicit preserve with empty fields is read-only and first selection supports empty local base', async () => {
  const h = fixture(SciLLM.normalizeLiteratureNoteDocumentState(null));
  const empty = await h.send(delta({ mode: 'preserve' }));
  assert.equal(empty.success, true);
  assert.equal(h.writes, 0);
  assert.deepEqual(empty.data.templateSelectionBase, { templateId: '', updatedAt: 0 });
  const selected = await h.send(delta(selection('template_b', '', 0)));
  assert.equal(selected.success, true);
  assert.equal(h.state().templateId, 'template_b');
  assert.equal(h.writes, 1);
});

test('invalid explicit metadata with valid private body fails atomically and never echoes it', async () => {
  const h = fixture();
  const response = await h.send(delta({ mode: 'set', expectedTemplateId: 'template_a',
    expectedUpdatedAt: -1 }, [body('PRIVATE_UNIQUE_CONTENT')]));
  assert.equal(response.success, false);
  assert.equal(h.writes, 0);
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_UNIQUE_CONTENT/);
});

test('same selection is a no-op but still checks its CAS base', async () => {
  const h = fixture();
  const result = await h.send(delta(selection('template_a'), [], 'template_a'));
  assert.equal(result.success, true);
  assert.equal(h.writes, 0);
  assert.equal(result.data.state.updatedAt, 10);
  const stale = await h.send(delta(selection('template_a', 'template_a', 9), [], 'template_a'));
  assert.equal(stale.error?.code, 'LITERATURE_NOTE_TEMPLATE_CONFLICT');
});

for (const version of [1, 2]) test(`metadata-only write freezes legacy v${version} field clocks`, async () => {
  const initial = note(); initial.schemaVersion = version;
  delete initial.fieldUpdatedAtByTemplate;
  const h = fixture(initial);
  const response = await h.send(delta(selection('template_b')));
  assert.equal(response.success, true);
  assert.equal(h.state().updatedAt, 11);
  assert.equal(h.state().fieldUpdatedAtByTemplate.template_a.finding, 10);
});

test('malformed explicit control fails closed without echoing private content', async () => {
  for (const control of [null, {}, { mode: 'unknown', secret: 'PRIVATE' },
    selection('template_b', 'template_a', '10'),
    selection('template_b', '__proto__'), { mode: 'preserve', templateId: 'PRIVATE' }]) {
    const h = fixture();
    const response = await h.send(delta(control));
    assert.equal(response.success, false, JSON.stringify(control));
    assert.equal(response.error.code, 'LITERATURE_NOTE_DELTA_INVALID');
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE/);
    assert.equal(h.writes, 0);
  }
});

test('failed storage leaves both selected template and body unchanged', async () => {
  const h = fixture(); h.fail(true);
  const response = await h.send(delta(selection('template_b'), [body()]));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'LITERATURE_NOTE_STORAGE_FAILED');
  assert.equal(h.state().templateId, 'template_a');
  assert.equal(h.state().valuesByTemplate.template_a.finding, 'original');
});

test('controlled revision overflow fails closed before normalization or storage writes', async () => {
  for (const control of [selection('template_b', 'template_a', Number.MAX_SAFE_INTEGER),
    { mode: 'preserve' }]) {
    const h = fixture(note('template_a', Number.MAX_SAFE_INTEGER));
    const response = await h.send(delta(control, control.mode === 'set' ? [] : [body()]));
    assert.equal(response.success, false);
    assert.equal(response.error.code, 'LITERATURE_NOTE_DELTA_INVALID');
    assert.equal(h.writes, 0);
    assert.equal(h.state().updatedAt, Number.MAX_SAFE_INTEGER);
  }
});

test('coordinator reserves metadata separately from body dirty fields', async () => {
  const h = fixture(); let state = note();
  state.templateId = 'template_b';
  let intent = { ...selection('template_b'), templateId: 'template_b', revision: 1 };
  const coordinator = helpers().createLiteratureNotePersistenceCoordinator({
    clone, merge: (saved, live) => ({ ...saved, valuesByTemplate: live.valuesByTemplate }),
    getState: () => state, setState: value => { state = value; },
    getDirtyRevisions: () => new Map(), clearDirtyRevision() {},
    getTemplateSelection: () => intent,
    clearTemplateSelection: revision => { if (intent?.revision === revision) intent = null; }
  });
  await coordinator.save(async ({ delta: change }) => {
    const response = await h.send(plain(change));
    assert.equal(response.success, true, JSON.stringify(response));
    return { state: response.data.state, localState: response.data.state,
      templateSelectionBase: response.data.templateSelectionBase, clearDirty: true };
  });
  assert.equal(h.state().templateId, 'template_b');
  assert.equal(intent, null);
});

test('A to B to C rebases only over our exact local ACK chain and preserves the latest UI', async () => {
  const c = client(); const held = gate(); const started = gate();
  c.select('template_b');
  const first = c.save(async payload => { const result = await c.commit(payload);
    started.resolve(); await held.promise; return result; });
  await started.promise;
  c.select('template_c');
  const second = c.save();
  held.resolve();
  await first;
  assert.equal(c.state.templateId, 'template_c');
  await second;
  assert.equal(c.h.state().templateId, 'template_c');
  assert.equal(c.h.state().updatedAt, 12);
  assert.equal(c.intent, null);
  assert.deepEqual(c.sent[1].templateSelection,
    { mode: 'set', expectedTemplateId: 'template_b', expectedUpdatedAt: 11 });
});

test('our body ACK advances an already queued template selection base', async () => {
  const c = client(); const held = gate(); const started = gate();
  c.edit('body before selection');
  const bodySave = c.save(async payload => { const result = await c.commit(payload);
    started.resolve(); await held.promise; return result; });
  await started.promise;
  c.select('template_b'); const selected = c.save(); held.resolve();
  await bodySave; await selected;
  assert.equal(c.h.state().templateId, 'template_b');
  assert.equal(c.h.state().valuesByTemplate.template_a.finding, 'body before selection');
  assert.equal(c.h.state().updatedAt, 12);
});

test('unknown external ACK never rebases a queued selection or overwrites its draft', async () => {
  const c = client(); const held = gate(); const started = gate();
  await c.h.send(delta(selection('template_c'), [], 'template_c'));
  c.edit('local body');
  const saving = c.save(async payload => { const result = await c.commit(payload);
    started.resolve(); await held.promise; return result; });
  await started.promise;
  c.select('template_b'); const selected = c.save();
  const rejection = assert.rejects(selected, { code: 'LITERATURE_NOTE_TEMPLATE_CONFLICT' });
  held.resolve(); await saving; await rejection;
  assert.equal(c.state.templateId, 'template_b');
  assert.equal(c.h.state().templateId, 'template_c');
  assert.equal(c.intent.expectedUpdatedAt, 10);
});

test('coordinator refuses an external ABA chain even when the saved template returns to A', async () => {
  const c = client();
  await c.h.send(delta(selection('template_b')));
  await c.h.send(delta(selection('template_a', 'template_b', 11), [], 'template_a'));
  const started = gate(); const held = gate(); c.edit('own body');
  const saving = c.save(async payload => { const result = await c.commit(payload);
    started.resolve(); await held.promise; return result; });
  await started.promise;
  c.select('template_c');
  const rejection = assert.rejects(c.save(), { code: 'LITERATURE_NOTE_TEMPLATE_CONFLICT' });
  held.resolve(); await saving; await rejection;
  assert.equal(c.intent.expectedUpdatedAt, 10);
  assert.equal(c.h.state().templateId, 'template_a');
});

test('body-only late ACK follows saved selection when there is no local selection intent', async () => {
  const c = client();
  await c.h.send(delta(selection('template_c'), [], 'template_c'));
  c.edit('local body'); await c.save();
  assert.equal(c.h.state().templateId, 'template_c');
  assert.equal(c.state.templateId, 'template_c');
});

test('local successful metadata plus workspace failure retries as preserve without replaying set', async () => {
  const c = client(); c.select('template_b');
  await c.save(async payload => ({ ...await c.commit(payload), clearDirty: false,
    state: { ...c.h.state(), templateId: 'workspace_fake', updatedAt: 900 } }));
  const retry = c.coordinator.getRetrySnapshot({ id: 'paper' });
  assert.equal(retry.localPendingDelta.templateSelection.mode, 'preserve');
  assert.equal(retry.workspacePendingTemplateSelection.templateId, 'template_b');
  assert.equal(c.base.templateId, 'template_b');
  assert.equal(c.base.updatedAt, 11, 'workspace-merged revision is not a CAS base');
  await c.h.send(delta(selection('template_c', 'template_b', 11), [], 'template_c'));
  c.leave(); c.reopen(); await c.save();
  assert.equal(c.sent.at(-1).templateSelection.mode, 'preserve');
  assert.equal(c.h.state().templateId, 'template_c');
  assert.equal(c.h.writes, 2);
  assert.equal(c.intent, null);
});

test('failed local selection survives context leave and reload without resetting its expected tuple', async () => {
  const c = client(); c.select('template_b'); c.h.fail(true);
  await assert.rejects(c.save(), { code: 'LITERATURE_NOTE_STORAGE_FAILED' });
  c.leave(); c.h.fail(false); c.reopen();
  assert.equal(c.state.templateId, 'template_b');
  assert.equal(c.intent.expectedUpdatedAt, 10);
  await c.save();
  assert.equal(c.h.state().templateId, 'template_b');
  assert.equal(c.intent, null);
});

test('preserve body retry overlay never restores a stale selected template', async () => {
  const c = client(); c.edit('pending body'); c.h.fail(true);
  await assert.rejects(c.save());
  assert.equal(c.coordinator.getRetrySnapshot({ id: 'paper' }).state.valuesByTemplate.template_a.finding,
    'pending body');
  c.leave(); c.h.fail(false);
  await c.h.send(delta(selection('template_c'), [], 'template_c'));
  c.reopen();
  assert.equal(c.state.templateId, 'template_c');
  assert.equal(c.state.valuesByTemplate.template_a.finding, 'pending body');
});

test('metadata queue capacity rejects reservation without clearing the live selection', async () => {
  const c = client(fixture(), { maxPendingBytes: 1 }); c.select('template_b');
  const reservation = c.coordinator.trySave(c.commit, { id: 'paper' });
  assert.equal(reservation.accepted, false);
  await assert.rejects(reservation.promise, { code: 'LITERATURE_NOTE_SAVE_QUEUE_CAPACITY' });
  assert.equal(c.intent.templateId, 'template_b');
  assert.equal(c.h.writes, 0);
});

test('metadata records count toward context capacity and rejected context leave retains its draft', async () => {
  const c = client(fixture(), { maxPendingContexts: 1 });
  const held = gate(); const started = gate(); c.select('template_b');
  const saving = c.save(async payload => { const result = await c.commit(payload);
    started.resolve(); await held.promise; return result; });
  await started.promise; c.leave(); c.select('template_c');
  const reservation = c.coordinator.trySave(c.commit, { id: 'other' });
  assert.equal(reservation.accepted, false);
  await assert.rejects(reservation.promise, { code: 'LITERATURE_NOTE_SAVE_QUEUE_CAPACITY' });
  assert.equal(c.intent.templateId, 'template_c');
  held.resolve(); await saving;
  assert.equal(c.state.templateId, 'template_c');
});

test('pending metadata snapshots coalesce with bounded bytes during own-ACK rebasing', async () => {
  const c = client(fixture(), { maxPendingBytes: 4096 });
  const held = gate(); const started = gate(); c.select('template_b');
  const saving = c.save(async payload => { const result = await c.commit(payload);
    started.resolve(); await held.promise; return result; });
  await started.promise;
  c.select('template_c'); const second = c.coordinator.trySave(c.commit, { id: 'paper' });
  const before = c.coordinator.getQueueStats();
  assert.ok(before.pendingBytes > 1000 && before.pendingBytes <= before.maxPendingBytes);
  c.select('template_d'); const third = c.coordinator.trySave(c.commit, { id: 'paper' });
  assert.equal(third.promise, second.promise);
  assert.equal(c.coordinator.getQueueStats().pendingContexts, 1);
  held.resolve(); await saving; await third.promise;
  assert.equal(c.h.state().templateId, 'template_d');
  assert.equal(c.h.writes, 2);
});

test('failed queued selection reload keeps the rebased intent base and its body-free retry', async () => {
  const c = client(); const started = gate(); const held = gate(); c.select('template_b');
  const first = c.save(async payload => { const result = await c.commit(payload);
    started.resolve(); await held.promise; return result; });
  await started.promise; c.select('template_c');
  const rejection = assert.rejects(c.save(async payload => {
    c.h.fail(true); return c.commit(payload);
  }), { code: 'LITERATURE_NOTE_STORAGE_FAILED' });
  held.resolve(); await first; await rejection;
  c.leave(); c.h.fail(false); c.reopen();
  assert.equal(c.intent.expectedTemplateId, 'template_b');
  assert.equal(c.intent.expectedUpdatedAt, 11);
  await c.save(); assert.equal(c.h.state().templateId, 'template_c');
});

test('stale metadata ACK after leaving does not update the new document or selection base', async () => {
  const c = client(); const held = gate(); const started = gate(); c.select('template_b');
  const saving = c.save(async payload => { const result = await c.commit(payload);
    started.resolve(); await held.promise; return result; });
  await started.promise; c.leave(); held.resolve();
  const result = await saving;
  assert.equal(result.stale, true);
  assert.equal(c.state.templateId, 'template_other');
});

test('popup no-op save clears a previously shown saving status', async () => {
  const r = runtime(); await r.api.load(); r.status.textContent = '正在保存…';
  const result = await r.api.persist();
  assert.equal(result.skipped, true);
  assert.equal(r.status.textContent, '已自动保存到本机');
});

test('popup load takes CAS base from local storage, not newer workspace merge', async () => {
  const r = runtime(fixture(), note('template_c', 900)); await r.api.load();
  assert.equal(r.api.state.templateId, 'template_c');
  assert.deepEqual(plain(r.api.base), { templateId: 'template_a', updatedAt: 10 });
});

test('real popup commit keeps local ACK separate from failed workspace merge and retries preserve', async () => {
  const r = runtime(); const requests = []; let workspaceOnline = false;
  const target = { workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 1 };
  r.context.captureLiteratureNoteContext = () => ({ id: 'paper', documentKey: 'paper',
    legacyKey: '', target });
  r.context.readLiteratureNoteWorkspaceState = async () => ({ target, revision: 7,
    state: note('template_c', 900) });
  r.context.chrome.runtime.sendMessage = async message => {
    requests.push(plain(message));
    if (message.type === 'LITERATURE_NOTE_COMMIT_DELTA') return r.h.send(plain(message.delta));
    assert.equal(message.type, 'ARTICLE_WORKSPACE_SAVE_ASSET');
    return workspaceOnline ? { success: true } : { success: false,
      error: { code: 'WORKSPACE_WRITE_FAILED' } };
  };
  await r.api.load();
  await r.api.change({ currentTarget: { value: 'template_b' } });
  assert.equal(r.h.state().templateId, 'template_b');
  assert.deepEqual(plain(r.api.base), { templateId: 'template_b', updatedAt: 11 });
  assert.match(r.status.textContent, /等待同步/);
  await r.h.send(delta(selection('template_c', 'template_b', 11), [], 'template_c'));
  workspaceOnline = true; await r.api.persist();
  const localRequests = requests.filter(message => message.type === 'LITERATURE_NOTE_COMMIT_DELTA');
  assert.equal(localRequests.length, 2);
  assert.equal(localRequests[1].delta.templateSelection.mode, 'preserve');
  assert.equal(r.h.writes, 2);
  assert.equal(r.api.state.templateId, 'template_c');
  assert.equal(r.api.selection, null);
  assert.equal(r.status.textContent, '已自动保存到本机');
});

test('popup discrete selection reserves immediately and persists without fabricated body dirtiness', async () => {
  const r = runtime(); await r.api.load();
  assert.equal(typeof r.api.change, 'function');
  const saving = r.api.change({ currentTarget: { value: 'template_b' } });
  assert.equal(r.api.coordinator.getQueueStats().active, 1,
    'reservation happens before yielding to preferences or any debounce');
  await saving;
  assert.equal(r.h.state().templateId, 'template_b');
  assert.equal(r.api.selection, null);
  assert.equal(r.status.textContent, '已自动保存到本机');
  assert.equal(r.h.writes, 1);
});

test('first direct body edit initializes an unowned visible template using the real nonzero local clock', async () => {
  const empty = SciLLM.normalizeLiteratureNoteDocumentState(null); empty.updatedAt = 27;
  const r = runtime(fixture(empty)); await r.api.load(); r.api.display('template_a');
  assert.equal(r.sent.length, 0, 'opening/rendering an empty note is not a metadata mutation');
  r.api.edit('first body'); await r.api.persist();
  assert.equal(r.h.state().templateId, 'template_a');
  assert.equal(r.h.state().valuesByTemplate.template_a.finding, 'first body');
  assert.deepEqual(r.sent[0].delta.templateSelection,
    { mode: 'set', expectedTemplateId: '', expectedUpdatedAt: 27 });
  r.context.llmSettingsState = { settings: { lastLiteratureNoteTemplateId: 'template_b' } };
  await r.api.load();
  assert.equal(r.api.state.templateId, 'template_a');
  r.api.edit('second body'); await r.api.persist();
  assert.equal(r.sent.at(-1).delta.templateSelection.mode, 'preserve');
});

test('a concurrent owner set before the first body write causes conflict and retains the new draft', async () => {
  const empty = SciLLM.normalizeLiteratureNoteDocumentState(null);
  const r = runtime(fixture(empty)); await r.api.load(); r.api.display('template_a');
  await r.h.send(delta(selection('template_b', '', 0)));
  r.api.edit('uncommitted first body');
  await assert.rejects(r.api.persist(), { code: 'LITERATURE_NOTE_TEMPLATE_CONFLICT' });
  assert.equal(r.h.state().templateId, 'template_b');
  assert.equal(r.api.state.valuesByTemplate.template_a.finding, 'uncommitted first body');
});

test('non-input note projection does not invent a first user template-selection intent', async () => {
  const r = runtime(fixture(SciLLM.normalizeLiteratureNoteDocumentState(null)));
  await r.api.load(); r.api.display('template_a'); r.api.edit('projected body', false);
  assert.equal(r.api.selection, null);
});

test('manual textarea input opts into first-owner initialization but shared AI/projected paths do not', () => {
  assert.match(source, /markLiteratureNoteFieldDirty\(mutation\.dirtyField,\s*\{\s*initializeTemplate: true\s*\}\)/);
});

test('popup explicit re-selection after conflict refreshes the local base without dropping the draft', async () => {
  const r = runtime(); await r.api.load();
  assert.equal(typeof r.api.change, 'function');
  await r.h.send(delta(selection('template_c'), [], 'template_c'));
  await r.api.change({ currentTarget: { value: 'template_b' } });
  assert.equal(r.h.state().templateId, 'template_c');
  assert.equal(r.api.state.templateId, 'template_b');
  assert.match(r.status.textContent, /冲突/);
  await r.api.change({ currentTarget: { value: 'template_a' } });
  assert.equal(r.h.state().templateId, 'template_a');
  assert.equal(r.api.selection, null);
  assert.equal(r.h.state().valuesByTemplate.template_a.finding, 'original');
});

test('known template conflict survives reopening without an automatic retry timer', async () => {
  const r = runtime(); await r.api.load();
  await r.h.send(delta(selection('template_c'), [], 'template_c'));
  await r.api.change({ currentTarget: { value: 'template_b' } });
  const timersBefore = r.timers.length;
  await r.api.load();
  assert.equal(r.timers.length, timersBefore);
  assert.equal(r.api.selection.expectedUpdatedAt, 10);
  assert.match(r.status.textContent, /冲突/);
});

test('known conflict reserve retains new body drafts across leave without repeatedly sending the failed CAS', async () => {
  const r = runtime(); await r.api.load();
  await r.h.send(delta(selection('template_c'), [], 'template_c'));
  await r.api.change({ currentTarget: { value: 'template_b' } });
  r.api.edit('body typed after conflict');
  const count = r.sent.length;
  const leave = r.api.reserve();
  assert.equal(leave.accepted, true);
  r.leave();
  await assert.rejects(leave.promise, { code: 'LITERATURE_NOTE_TEMPLATE_CONFLICT' });
  assert.equal(r.sent.length, count, 'accepted snapshot retention is not a new transport write');
  r.enter(); await r.api.load();
  assert.equal(r.api.state.templateId, 'template_b');
  assert.equal(r.api.state.valuesByTemplate.template_a.finding, 'body typed after conflict');
  assert.equal(r.timers.length, 0);
  await r.api.change({ currentTarget: { value: 'template_a' } });
  assert.equal(r.h.state().templateId, 'template_a');
  assert.equal(r.h.state().valuesByTemplate.template_a.finding, 'body typed after conflict');
  assert.equal(r.api.selection, null);
});

test('popup rejects a controlled response without ACK instead of falsely clearing its selection', async () => {
  const r = runtime(); await r.api.load();
  r.context.chrome.runtime.sendMessage = async () => ({ success: true,
    data: { saved: true, state: r.h.state() } });
  await r.api.change({ currentTarget: { value: 'template_b' } });
  assert.equal(r.api.selection.templateId, 'template_b');
  assert.match(r.status.textContent, /失败/);
});

test('an older successful popup selection cannot show saved while a newer selection waits', async () => {
  const r = runtime(); await r.api.load();
  const started = gate(); const firstGate = gate(); const secondGate = gate();
  let count = 0;
  r.context.chrome.runtime.sendMessage = async message => {
    count += 1; const response = await r.h.send(plain(message.delta));
    if (count === 1) { started.resolve(); await firstGate.promise; }
    else await secondGate.promise;
    return response;
  };
  const first = r.api.change({ currentTarget: { value: 'template_b' } });
  await started.promise;
  const second = r.api.change({ currentTarget: { value: 'template_c' } });
  firstGate.resolve(); await first;
  assert.equal(r.status.textContent, '正在保存…');
  secondGate.resolve(); await second;
  assert.equal(r.status.textContent, '已自动保存到本机');
});

test('conflict rereads are guarded against context leave and a newer explicit selection', async () => {
  const r = runtime(); await r.api.load();
  await r.h.send(delta(selection('template_c'), [], 'template_c'));
  await r.api.change({ currentTarget: { value: 'template_b' } });
  const reads = [];
  r.context.chrome.storage.local.get = async key => {
    const held = gate(); reads.push(held); await held.promise;
    return { [key]: clone(r.h.values[key]) };
  };
  const first = r.api.change({ currentTarget: { value: 'template_a' } });
  const second = r.api.change({ currentTarget: { value: 'template_b' } });
  reads[1].resolve(); await second;
  reads[0].resolve(); await first;
  assert.equal(r.h.state().templateId, 'template_b');
  assert.equal(r.h.writes, 2);
  await r.h.send(delta(selection('template_c', 'template_b', 12), [], 'template_c'));
  await r.api.change({ currentTarget: { value: 'template_a' } });
  const before = r.h.writes;
  const stale = r.api.change({ currentTarget: { value: 'template_b' } });
  r.leave(); reads[2].resolve(); await stale;
  assert.equal(r.h.writes, before);
});

test('template conflict has a safe English UI translation', () => {
  const i18n = require('../core/i18n.js');
  assert.notEqual(i18n.translateInterfaceText('笔记模板保存冲突；草稿已保留，请重新选择模板后重试', 'en'),
    '笔记模板保存冲突；草稿已保留，请重新选择模板后重试');
});
