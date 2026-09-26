const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');

function executableFunctionSource(script, name) {
  const marker = `function ${name}(`;
  const functionIndex = script.indexOf(marker);
  assert.ok(functionIndex >= 0, `${name} must exist`);
  const start = script.slice(Math.max(0, functionIndex - 6), functionIndex) === 'async '
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function turn() {
  await new Promise(resolve => setImmediate(resolve));
}

function makeNative(documentHash = 'a'.repeat(64), overrides = {}) {
  return {
    structure: { documentHash }, documentGeneration: 7, pageCount: 23, ...overrides
  };
}

function makeFigure(documentHash = 'a'.repeat(64), overrides = {}) {
  return {
    figureId: 'figure-2', sourceKind: 'pdf-page-caption', sourceFingerprint: documentHash,
    caption: 'Figure 2. Results from the complete experiment.',
    captionPageNumbers: [3], pageNumber: 3, artworkCoverage: 'needs-review',
    analysisImages: [{ stale: true }], ...overrides
  };
}

function savedSelection(figure, native, overrides = {}) {
  return {
    version: 'pdf-figure-artwork-selection-v1',
    documentHash: native.structure.documentHash,
    figureId: figure.figureId,
    caption: figure.caption,
    captionPageNumbers: [...(figure.captionPageNumbers || figure.pageNumbers || [figure.pageNumber])],
    pageCount: native.pageCount,
    artworkPageNumbers: [5, 6],
    coverageConfirmed: true,
    ...overrides
  };
}

function loadArtworkHarness({ getSaved = async () => null, persist, notify = () => {} } = {}) {
  const persisted = [];
  const rendered = [];
  const context = {
    console,
    getWorkspaceAssetCheckpoint: getSaved,
    persistWorkspaceAssetCheckpoint: persist || (async (assetPath, content, options) => {
      options.commitGuard();
      persisted.push({ assetPath, content: JSON.parse(JSON.stringify(content)), options });
      return { saved: true };
    }),
    notifyFigureWorkspaceStateChanged: notify
  };
  vm.runInNewContext(`
    const pdfFigureArtworkRestoreOwners = new WeakMap();
    const pdfFigureArtworkSaveOwners = new WeakMap();
    const pdfFigureProductionEnvelopes = new Map();
    const pdfFigureProductionEnvelopeOwners = new Map();
    const FIGURE_IMAGE_LIMIT = 4;
    ${executableFunctionSource(contentSource, 'pdfFigureProductionError')}
    ${executableFunctionSource(contentSource, 'pdfFigureArtworkSelectionPath')}
    ${executableFunctionSource(contentSource, 'validatedPdfFigureArtworkSelection')}
    ${executableFunctionSource(contentSource, 'pdfFigureArtworkOwnerSignature')}
    ${executableFunctionSource(contentSource, 'restoreNativePdfFigureArtworkSelection')}
    ${executableFunctionSource(contentSource, 'setPdfFigureArtworkPages')}
    ${executableFunctionSource(contentSource, 'ensureNativePdfFigureImages')}
    globalThis.artworkApi = {
      restoreNativePdfFigureArtworkSelection,
      setPdfFigureArtworkPages,
      ensureNativePdfFigureImages,
      primeRestoreOwner(figure, native, selection, promise) {
        pdfFigureArtworkRestoreOwners.set(figure, {
          native,
          signature: pdfFigureArtworkOwnerSignature(figure, native),
          selection,
          promise
        });
      },
      dropRestoreOwner(figure) {
        pdfFigureArtworkRestoreOwners.delete(figure);
      }
    };
  `, context);
  context.__brevessPdfReaderBridge = {
    command: async (action, page, options) => {
      rendered.push({ action, page, options });
      return {
        dataUrl: `data:image/png;base64,cGFnZS0${page}=`, width: 1200, height: 1600,
        documentHash: context.__brevessNativePdfDocument.structure.documentHash,
        documentGeneration: context.__brevessNativePdfDocument.documentGeneration
      };
    }
  };
  return { context, persisted, rendered, ...context.artworkApi };
}

function bindDocument(harness, native, figures) {
  harness.context.__brevessNativePdfDocument = native;
  harness.context.__brevessNativePdfFigures = {
    documentHash: native.structure.documentHash, figures
  };
}

function requestFor(figure, native, pageNumbers, coverageConfirmed = true) {
  return {
    figureId: figure.figureId,
    documentHash: native.structure.documentHash,
    pageNumbers,
    coverageConfirmed
  };
}

function assertCode(code) {
  return error => {
    assert.equal(error?.code, code);
    return true;
  };
}

test('unconfirmed whole-Figure and Panel vision stop before image render/admission while text routes use zero images', async () => {
  const counters = { restore: 0, prepare: 0, ensure: 0, build: 0, record: 0 };
  const context = {
    console,
    activeNativePdfStructure: () => ({ documentHash: 'a'.repeat(64) }),
    restoreNativePdfFigureArtworkSelection: async () => { counters.restore += 1; },
    prepareFigureImages: async () => { counters.prepare += 1; return [{ dataUrl: 'should-not-run' }]; },
    selectPdfFigureProductionImage: images => images,
    restorePdfFigurePreparedImageMetadata: (_figure, image) => image,
    buildPdfFigureProductionEnvelope: async (_figure, options) => {
      counters.build += 1;
      return { route: options.route, imageCount: options.images.length };
    },
    recordPdfFigureProductionEnvelope: () => { counters.record += 1; },
    ensureNativePdfFigureImages: async () => { counters.ensure += 1; },
    requireFigureTaskAdmission: admission => admission
  };
  vm.runInNewContext(`
    ${executableFunctionSource(contentSource, 'pdfFigureProductionError')}
    ${executableFunctionSource(contentSource, 'preparePdfFigureProductionInput')}
    ${executableFunctionSource(contentSource, 'prepareFigurePanelImageVariants')}
    globalThis.entryApi = { preparePdfFigureProductionInput, prepareFigurePanelImageVariants };
  `, context);
  const figure = makeFigure();
  const vision = { route: { capabilityMode: 'vision' } };
  const textOnly = { route: { capabilityMode: 'caption_text_only' } };

  await assert.rejects(
    context.entryApi.preparePdfFigureProductionInput(figure, vision),
    assertCode('PDF_FIGURE_ARTWORK_COVERAGE_INCOMPLETE')
  );
  assert.equal(counters.prepare, 0, 'whole-Figure pixels must not enter provider admission');
  await assert.rejects(
    context.entryApi.prepareFigurePanelImageVariants(
      figure, 'A', vision, 'figure_panel_interpretation'
    ),
    assertCode('PDF_FIGURE_ARTWORK_COVERAGE_INCOMPLETE')
  );
  assert.equal(counters.ensure, 0, 'Panel pixels must not render before coverage confirmation');

  const wholeText = await context.entryApi.preparePdfFigureProductionInput(figure, textOnly);
  const panelText = await context.entryApi.prepareFigurePanelImageVariants(
    figure, 'A', textOnly, 'figure_panel_interpretation'
  );
  assert.equal(wholeText.images.length, 0);
  assert.equal(wholeText.envelope.route, 'text-only');
  assert.equal(panelText.length, 0);
  assert.equal(counters.prepare, 0);
  assert.equal(counters.ensure, 0);
});

test('confirmed [5, 6] is persisted exactly and native PDF rendering preserves page order', async () => {
  const native = makeNative();
  const figure = makeFigure();
  const notifications = [];
  const harness = loadArtworkHarness({
    notify: (...args) => notifications.push(args)
  });
  bindDocument(harness, native, [figure]);

  const result = await harness.setPdfFigureArtworkPages(requestFor(figure, native, [5, 6]));
  assert.deepEqual(Array.from(result.pageNumbers), [5, 6]);
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.persisted[0].assetPath, 'pdf/figure-artwork/figure-2.json');
  assert.deepEqual(harness.persisted[0].content.artworkPageNumbers, [5, 6]);
  assert.equal(harness.persisted[0].content.coverageConfirmed, true);
  assert.deepEqual(Array.from(figure.artworkPageNumbers), [5, 6]);
  assert.equal(figure.artworkCoverage, 'complete');
  assert.equal(figure.artworkPageEvidence, 'user-selection');
  assert.equal(figure.analysisImages.length, 0);
  assert.equal(notifications.length, 1);

  await harness.ensureNativePdfFigureImages(figure);
  assert.deepEqual(harness.rendered.map(call => call.page), [5, 6]);
  assert.deepEqual(Array.from(figure.analysisImages, image => image.sourcePage), [5, 6]);
});

test('a reloaded figure from the same PDF restores the confirmed selection', async () => {
  const native = makeNative();
  const original = makeFigure();
  const saved = savedSelection(original, native);
  const harness = loadArtworkHarness({ getSaved: async () => ({ content: saved }) });
  const reloaded = makeFigure();
  bindDocument(harness, native, [reloaded]);

  await harness.restoreNativePdfFigureArtworkSelection(reloaded);
  assert.deepEqual(Array.from(reloaded.artworkPageNumbers), [5, 6]);
  assert.equal(reloaded.artworkCoverage, 'complete');
  assert.equal(reloaded.artworkPageEvidence, 'user-selection');
});

test('a cache hit restores the validated persisted pages after in-place artwork page tampering', async () => {
  const native = makeNative();
  const figure = makeFigure();
  const harness = loadArtworkHarness();
  bindDocument(harness, native, [figure]);
  await harness.setPdfFigureArtworkPages(requestFor(figure, native, [5, 6]));

  figure.artworkPageNumbers = [7];
  figure.artworkCoverage = 'complete';
  figure.artworkPageEvidence = 'user-selection';
  await harness.restoreNativePdfFigureArtworkSelection(figure);

  assert.deepEqual(Array.from(figure.artworkPageNumbers), [5, 6]);
  await harness.ensureNativePdfFigureImages(figure);
  assert.deepEqual(harness.rendered.map(call => call.page), [5, 6]);
  assert.equal(harness.rendered.some(call => call.page === 7), false);
});

for (const scenario of [
  {
    name: 'document',
    alterSaved: value => { value.documentHash = 'b'.repeat(64); }
  },
  {
    name: 'caption',
    alterFigure: value => { value.caption = 'Figure 2. A changed caption.'; }
  },
  {
    name: 'caption pages',
    alterFigure: value => { value.captionPageNumbers = [4]; }
  },
  {
    name: 'page count',
    alterNative: value => { value.pageCount = 24; }
  }
]) {
  test(`restore rejects a saved selection after ${scenario.name} changes`, async () => {
    const baselineNative = makeNative();
    const baselineFigure = makeFigure();
    const saved = savedSelection(baselineFigure, baselineNative);
    const native = makeNative();
    const figure = makeFigure();
    scenario.alterSaved?.(saved);
    scenario.alterNative?.(native);
    scenario.alterFigure?.(figure);
    const harness = loadArtworkHarness({ getSaved: async () => ({ content: saved }) });
    bindDocument(harness, native, [figure]);

    await assert.rejects(
      harness.restoreNativePdfFigureArtworkSelection(figure),
      assertCode('PDF_FIGURE_ARTWORK_SELECTION_INVALID')
    );
    assert.equal(figure.artworkCoverage, 'needs-review');
  });
}

test('an in-place identity change while persistence is pending makes the commit stale', async () => {
  const native = makeNative();
  const figure = makeFigure();
  const gate = deferred();
  let persistStarted = false;
  const harness = loadArtworkHarness({
    persist: async () => { persistStarted = true; return gate.promise; }
  });
  bindDocument(harness, native, [figure]);

  const pending = harness.setPdfFigureArtworkPages(requestFor(figure, native, [5, 6]));
  while (!persistStarted) await turn();
  figure.caption = 'Figure 2. Identity changed while saving.';
  gate.resolve({ saved: true });
  await assert.rejects(pending, assertCode('PDF_FIGURE_CONTEXT_STALE'));
  assert.equal(figure.artworkCoverage, 'needs-review');
  assert.equal(figure.analysisImages.length, 1);
});

test('a concurrent newer selection owns the commit and makes the older save stale', async () => {
  const native = makeNative();
  const figure = makeFigure();
  const gates = [];
  const harness = loadArtworkHarness({
    persist: async (_assetPath, selection) => {
      const gate = deferred();
      gates.push({ gate, pages: Array.from(selection.artworkPageNumbers) });
      return gate.promise;
    }
  });
  bindDocument(harness, native, [figure]);

  const older = harness.setPdfFigureArtworkPages(requestFor(figure, native, [5]));
  while (gates.length < 1) await turn();
  const newer = harness.setPdfFigureArtworkPages(requestFor(figure, native, [6]));
  while (gates.length < 2) await turn();
  gates[1].gate.resolve({ saved: true });
  const latest = await newer;
  assert.deepEqual(Array.from(latest.pageNumbers), [6]);
  gates[0].gate.resolve({ saved: true });
  await assert.rejects(older, assertCode('PDF_FIGURE_CONTEXT_STALE'));
  assert.deepEqual(Array.from(figure.artworkPageNumbers), [6]);
});

test('a concurrent invalid request cannot steal ownership from a valid save awaiting persistence', async () => {
  const native = makeNative();
  const figure = makeFigure();
  const gate = deferred();
  let persistStarted = false;
  const harness = loadArtworkHarness({
    persist: async (_assetPath, _selection, options) => {
      persistStarted = true;
      await gate.promise;
      options.commitGuard();
      return { saved: true };
    }
  });
  bindDocument(harness, native, [figure]);

  const valid = harness.setPdfFigureArtworkPages(requestFor(figure, native, [5, 6]));
  while (!persistStarted) await turn();
  await assert.rejects(
    harness.setPdfFigureArtworkPages(requestFor(figure, native, [7, 7])),
    assertCode('PDF_FIGURE_ARTWORK_SELECTION_INVALID')
  );
  gate.resolve();
  const result = await valid;

  assert.deepEqual(Array.from(result.pageNumbers), [5, 6]);
  assert.deepEqual(Array.from(figure.artworkPageNumbers), [5, 6]);
  assert.equal(figure.artworkCoverage, 'complete');
  assert.equal(figure.artworkPageEvidence, 'user-selection');
});

test('a pending cache-hit restore follows the newer successful selection instead of replaying its old entry', async () => {
  const native = makeNative();
  const figure = makeFigure();
  const oldGate = deferred();
  const harness = loadArtworkHarness();
  bindDocument(harness, native, [figure]);
  harness.primeRestoreOwner(
    figure, native, savedSelection(figure, native), oldGate.promise
  );

  const pendingOldCacheHit = harness.restoreNativePdfFigureArtworkSelection(figure);
  harness.dropRestoreOwner(figure);
  const newer = await harness.setPdfFigureArtworkPages(requestFor(figure, native, [7, 8]));
  assert.deepEqual(Array.from(newer.pageNumbers), [7, 8]);
  oldGate.resolve();
  await pendingOldCacheHit;

  assert.deepEqual(Array.from(figure.artworkPageNumbers), [7, 8]);
  await harness.ensureNativePdfFigureImages(figure);
  assert.deepEqual(harness.rendered.map(call => call.page), [7, 8]);
  assert.equal(harness.rendered.some(call => call.page === 5 || call.page === 6), false);
});

for (const scenario of [
  { name: 'missing confirmation', pages: [5], confirmed: false },
  { name: 'duplicate pages', pages: [5, 5], confirmed: true },
  { name: 'more than four pages', pages: [1, 2, 3, 4, 5], confirmed: true },
  { name: 'page zero', pages: [0], confirmed: true },
  { name: 'page beyond the document', pages: [24], confirmed: true },
  { name: 'no pages', pages: [], confirmed: true }
]) {
  test(`selection rejects ${scenario.name} before persistence`, async () => {
    const native = makeNative();
    const figure = makeFigure();
    let writes = 0;
    const harness = loadArtworkHarness({
      persist: async () => { writes += 1; return { saved: true }; }
    });
    bindDocument(harness, native, [figure]);

    await assert.rejects(
      harness.setPdfFigureArtworkPages(
        requestFor(figure, native, scenario.pages, scenario.confirmed)
      ),
      assertCode('PDF_FIGURE_ARTWORK_SELECTION_INVALID')
    );
    assert.equal(writes, 0);
  });
}

test('an explicit valid confirmation can replace an invalid old saved selection', async () => {
  const native = makeNative();
  const figure = makeFigure();
  const invalidOld = savedSelection(figure, native, { artworkPageNumbers: [5, 5] });
  const harness = loadArtworkHarness({
    getSaved: async () => ({ content: invalidOld })
  });
  bindDocument(harness, native, [figure]);

  const result = await harness.setPdfFigureArtworkPages(requestFor(figure, native, [7, 8]));
  assert.deepEqual(Array.from(result.pageNumbers), [7, 8]);
  assert.equal(harness.persisted.length, 1);
  assert.deepEqual(harness.persisted[0].content.artworkPageNumbers, [7, 8]);
});

class FakeElement {
  constructor(tagName = 'div', className = '', textContent = '') {
    this.tagName = String(tagName).toUpperCase();
    this.className = className;
    this.textContent = textContent;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  focus() { this.focused = true; }
  async dispatch(type) {
    return this.listeners.get(type)?.({ target: this, preventDefault() {} });
  }
}

function loadPopupArtworkControl({ send, refresh = async () => {}, current = () => true } = {}) {
  const document = {
    createElement: tag => new FakeElement(tag),
    createTextNode: text => new FakeElement('#text', '', String(text))
  };
  const context = {
    document,
    createWorkspaceElement: (tag, className = '', text = '') =>
      new FakeElement(tag, className, text),
    queryPanelTargetTab: async () => ({ id: 41 }),
    isCurrentFigureTask: current,
    sendTabMessage: send,
    refreshArticleWorkspace: refresh
  };
  vm.runInNewContext(`
    let figureTaskGeneration = 9;
    ${executableFunctionSource(popupSource, 'createPdfFigureArtworkPageControl')}
    globalThis.createControl = createPdfFigureArtworkPageControl;
  `, context);
  return context.createControl;
}

function popupParts(control) {
  const [toggle, form] = control.children;
  const [label, checkLabel, save, feedback] = form.children;
  return {
    toggle, form, input: label.children[0], checkbox: checkLabel.children[0], save, feedback
  };
}

test('popup artwork form expands 5-6 and sends the confirmed ordered selection', async () => {
  const messages = [];
  let refreshes = 0;
  const createControl = loadPopupArtworkControl({
    send: async (tabId, message) => {
      messages.push({ tabId, message: JSON.parse(JSON.stringify(message)) });
      return { success: true };
    },
    refresh: async () => { refreshes += 1; }
  });
  const control = createControl({
    figureId: 'figure-2', sourcePage: 3, pdfPageCount: 23,
    documentHash: 'a'.repeat(64), artworkCoverage: 'needs-review'
  });
  const parts = popupParts(control);
  await parts.toggle.dispatch('click');
  assert.equal(parts.form.hidden, false);
  assert.equal(parts.input.focused, true);
  parts.input.value = '5-6';
  parts.checkbox.checked = true;

  await parts.form.dispatch('submit');
  assert.deepEqual(messages, [{
    tabId: 41,
    message: {
      action: 'setPdfFigureArtworkPages', figureId: 'figure-2',
      documentHash: 'a'.repeat(64), pageNumbers: [5, 6], coverageConfirmed: true
    }
  }]);
  assert.equal(parts.feedback.textContent, '已保存，后续视觉解读将使用这些页。');
  assert.equal(parts.save.disabled, false);
  assert.equal(refreshes, 1);
});

for (const scenario of [
  { name: 'reversed range', value: '6-5', message: /页码须在/u },
  { name: 'duplicate pages', value: '5,5', message: /不重复/u },
  { name: 'range longer than four pages', value: '5-9', message: /最多选择 4 页/u },
  { name: 'out-of-range page', value: '24', message: /页码须在/u },
  { name: 'non-page token', value: '5-x', message: /连续范围/u }
]) {
  test(`popup artwork form reports ${scenario.name} without messaging the tab`, async () => {
    let sends = 0;
    const createControl = loadPopupArtworkControl({
      send: async () => { sends += 1; return { success: true }; }
    });
    const parts = popupParts(createControl({
      figureId: 'figure-2', sourcePage: 3, pdfPageCount: 23,
      documentHash: 'a'.repeat(64), artworkCoverage: 'needs-review'
    }));
    parts.input.value = scenario.value;
    parts.checkbox.checked = true;

    await parts.form.dispatch('submit');
    assert.match(parts.feedback.textContent, scenario.message);
    assert.equal(parts.save.disabled, false);
    assert.equal(sends, 0);
  });
}
