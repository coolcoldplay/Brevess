const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const popup = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');

function functionSource(name, script = content) {
  let start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing production function: ${name}`);
  if (script.slice(start - 6, start) === 'async ') start -= 6;
  const bodyStart = script.indexOf(') {', start) + 2;
  assert.ok(bodyStart > start, `missing function body: ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === '{') depth += 1;
    if (script[index] === '}') depth -= 1;
    if (!depth) return script.slice(start, index + 1);
  }
  assert.fail(`unterminated function: ${name}`);
}

function harness({ pdf = true, focusPage, checkpoint = null } = {}) {
  const documentHash = 'a'.repeat(64);
  const structure = { documentHash, paragraphs: [] };
  const figure = {
    figureId: 'figure-1', sourceKind: 'pdf-page-caption',
    sourceFingerprint: documentHash, artworkPageNumbers: [5, 6],
    caption: 'Figure 1. Caption', captionPageNumbers: [4]
  };
  const figures = [figure];
  const calls = { viewer: [], closed: 0, focused: [], events: [] };
  const native = {
    structure, documentGeneration: 7, pageCount: 12,
    focusPage: focusPage || (page => { calls.focused.push(page); return true; })
  };
  const globals = {
    __brevessNativePdfDocument: native,
    __brevessNativePdfFigures: { documentHash, figures }
  };
  const document = {
    body: { dataset: {} },
    dispatchEvent(event) { calls.events.push(event); return true; }
  };
  const dependencies = {
    globalThis: globals,
    pdfFigureArtworkRestoreOwners: new WeakMap(),
    getWorkspaceAssetCheckpoint: async () => ({ content: checkpoint }),
    pdfFigureProductionError: code => Object.assign(new Error(code), { code }),
    document,
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
    activeNativePdfStructure: () => pdf && document.body.dataset.pdfView !== 'parsed'
      ? globals.__brevessNativePdfDocument?.structure : null,
    closeFigureImageViewer: () => { calls.closed += 1; },
    showFigureImageViewer: async (figureId, options) => {
      calls.viewer.push({ figureId, options });
      return { success: true, open: true, figureId };
    }
  };
  const names = [
    'pdfFigureArtworkSelectionPath',
    'validatedPdfFigureArtworkSelection',
    'pdfFigureArtworkOwnerSignature',
    'restoreNativePdfFigureArtworkSelection',
    'pdfFigureOriginalNavigationError',
    'captureNativePdfFigureOriginalTarget',
    'nativePdfFigureOriginalTargetCurrent',
    'focusNativePdfFigureOriginalPage',
    'showFigureOriginalImage'
  ];
  const api = new Function(...Object.keys(dependencies),
    `${names.map(name => functionSource(name)).join('\n')}\nreturn { ${names.join(', ')} };`
  )(...Object.values(dependencies));
  return { api, globals, native, figures, figure, calls, document, documentHash };
}

test('rebuilt PDF inventory restores confirmed artwork pages before default or explicit navigation', async () => {
  const checkpoint = { version: 'pdf-figure-artwork-selection-v1', coverageConfirmed: true,
    documentHash: 'a'.repeat(64), figureId: 'figure-1', caption: 'Figure 1. Caption',
    pageCount: 12, captionPageNumbers: [4], artworkPageNumbers: [5, 6] };
  const fixture = harness({ checkpoint });
  for (const sourcePage of [undefined, 6]) {
    // The PDF reader replaces the Figure objects while its text index grows.
    const replacement = { ...fixture.figure, artworkPageNumbers: [4], artworkPageEvidence: 'caption-page' };
    fixture.globals.__brevessNativePdfFigures = {
      documentHash: fixture.documentHash, figures: [replacement]
    };
    const result = await fixture.api.showFigureOriginalImage('figure-1', {
      documentHash: fixture.documentHash, documentGeneration: 7, sourcePage
    });
    assert.equal(result.pageNumber, sourcePage || 5);
    assert.deepEqual(replacement.artworkPageNumbers, [5, 6]);
  }
  assert.deepEqual(fixture.calls.focused, [5, 6]);
});

test('PDF Figure original uses the current requested artwork page without opening the image viewer', async () => {
  const fixture = harness();
  const result = await fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash,
    documentGeneration: 7,
    panelId: 'M',
    sourcePage: 6
  });
  assert.deepEqual(fixture.calls.focused, [6]);
  assert.equal(fixture.calls.viewer.length, 0);
  assert.equal(fixture.calls.closed, 1);
  assert.deepEqual(result, {
    success: true, open: false, mode: 'pdf-page', figureId: 'figure-1',
    pageNumber: 6, panelId: 'M', pending: false
  });
});

test('PDF Figure original resolves the first live artwork page on every request', async () => {
  const fixture = harness();
  await fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash, documentGeneration: 7
  });
  fixture.figure.artworkPageNumbers = [8, 9];
  await fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash, documentGeneration: 7
  });
  assert.deepEqual(fixture.calls.focused, [5, 8]);
});

test('PDF Figure original rejects stale document owners and unverified page hints', async () => {
  const fixture = harness();
  await assert.rejects(() => fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: 'b'.repeat(64), documentGeneration: 7
  }), error => error?.code === 'PDF_FIGURE_CONTEXT_STALE');
  await assert.rejects(() => fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash, documentGeneration: 6
  }), error => error?.code === 'PDF_FIGURE_CONTEXT_STALE');
  await assert.rejects(() => fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash, documentGeneration: 7, sourcePage: 4
  }), error => error?.code === 'PDF_FIGURE_PAGE_UNVERIFIED');
  assert.deepEqual(fixture.calls.focused, []);
  assert.equal(fixture.calls.closed, 0);
});

test('PDF Figure original fails closed when the native owner changes while focus is pending', async () => {
  let release;
  let started;
  const focusStarted = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = harness({ focusPage: () => { started(); return pending; } });
  const operation = fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash, documentGeneration: 7
  });
  await focusStarted;
  fixture.globals.__brevessNativePdfDocument = {
    ...fixture.native, documentGeneration: 8
  };
  release(true);
  await assert.rejects(operation, error => error?.code === 'PDF_FIGURE_CONTEXT_STALE');
});

test('PDF Figure original rejects in-place artwork and focus callback replacement', async () => {
  let release;
  let started;
  const focusStarted = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = harness({ focusPage: () => { started(); return pending; } });
  const operation = fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash, documentGeneration: 7
  });
  await focusStarted;
  fixture.figure.artworkPageNumbers = null;
  release(true);
  await assert.rejects(operation, error => error?.code === 'PDF_FIGURE_CONTEXT_STALE');

  const second = harness({ focusPage(page) {
    second.native.focusPage = () => true;
    second.calls.focused.push(page);
    return true;
  } });
  await assert.rejects(() => second.api.showFigureOriginalImage('figure-1', {
    documentHash: second.documentHash, documentGeneration: 7
  }), error => error?.code === 'PDF_FIGURE_CONTEXT_STALE');
});

test('PDF Figure original treats an unmounted reader page as queued navigation', async () => {
  const fixture = harness({ focusPage: page => {
    fixture?.calls?.focused?.push(page);
    return false;
  } });
  const result = await fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash, documentGeneration: 7
  });
  assert.equal(result.success, true);
  assert.equal(result.pending, true);
  assert.equal(result.pageNumber, 5);
});

test('non-PDF Figure original preserves the existing image-viewer interaction', async () => {
  const fixture = harness({ pdf: false });
  const result = await fixture.api.showFigureOriginalImage('figure-web');
  assert.equal(result.open, true);
  assert.deepEqual(fixture.calls.viewer, [{ figureId: 'figure-web', options: {} }]);
  assert.equal(fixture.calls.closed, 0);
});

test('an old PDF request cannot fall through to the webpage image viewer after a source switch', async () => {
  const fixture = harness({ pdf: false });
  delete fixture.globals.__brevessNativePdfDocument;
  delete fixture.globals.__brevessNativePdfFigures;
  await assert.rejects(() => fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash, documentGeneration: 7
  }), error => error?.code === 'PDF_FIGURE_CONTEXT_STALE');
  assert.equal(fixture.calls.viewer.length, 0);
});

test('parsed PDF mode switches to the original reader page instead of opening an image overlay', async () => {
  const fixture = harness();
  fixture.document.body.dataset.pdfView = 'parsed';
  const result = await fixture.api.showFigureOriginalImage('figure-1', {
    documentHash: fixture.documentHash, documentGeneration: 7, sourcePage: 6
  });
  assert.equal(result.mode, 'pdf-page');
  assert.equal(result.pageNumber, 6);
  assert.equal(fixture.calls.viewer.length, 0);
  assert.deepEqual(fixture.calls.events.map(event => [event.type, event.detail]), [
    ['brevess:pdf-focus-page', { page: 6 }]
  ]);
});

test('sidebar original-image message forwards PDF identity and active-panel page hints', () => {
  assert.match(content,
    /showFigureOriginalImage\(String\(request\.figureId \|\| ''\),\s*\{[\s\S]*documentHash:\s*request\.documentHash,[\s\S]*documentGeneration:\s*request\.documentGeneration,[\s\S]*panelId:\s*request\.panelId,[\s\S]*sourcePage:\s*request\.sourcePage/);
});

test('sidebar derives a panel page only from the current PDF snapshot and active panel', () => {
  const figure = {
    figureId: 'figure-1', sourceKind: 'pdf-page-caption',
    documentHash: 'a'.repeat(64), pdfDocumentGeneration: 7,
    artworkPageNumbers: [5, 6], activeDepth: 'deep',
    deep: {
      pdfPanelInventory: {
        version: 'pdf-figure-panel-inventory-v3',
        provenance: { figureId: 'figure-1', visualEvidenceSetDigest: 'set-1' },
        panelPageMap: { A: 5, M: 6 },
        markers: [{ label: 'M', clarity: 'clear', pageNumber: 6 }]
      },
      pdfEvidenceBinding: {
        figureId: 'figure-1',
        binding: { documentHash: 'a'.repeat(64), documentGeneration: 7 },
        visualEvidenceSet: { setDigest: 'set-1' }
      }
    }
  };
  const dependencies = {
    currentWorkspaceSnapshot: { figures: { figures: [figure] } },
    figurePanelExpansionState: new Map([['figure-1::M', true]]),
    document: { querySelectorAll: () => [] }
  };
  const currentFigureOriginalPdfRequest = new Function(...Object.keys(dependencies),
    `${functionSource('currentFigureOriginalPdfRequest', popup)}\n` +
    'return currentFigureOriginalPdfRequest;'
  )(...Object.values(dependencies));
  assert.deepEqual(currentFigureOriginalPdfRequest('figure-1'), {
    documentHash: figure.documentHash,
    documentGeneration: 7,
    panelId: 'M',
    sourcePage: 6
  });
  figure.deep.pdfPanelInventory.panelPageMap.M = 4;
  assert.deepEqual(currentFigureOriginalPdfRequest('figure-1'), {
    documentHash: figure.documentHash,
    documentGeneration: 7
  });
  figure.deep.pdfPanelInventory.panelPageMap.M = 6;
  figure.deep.pdfEvidenceBinding.binding.documentGeneration = 6;
  assert.deepEqual(currentFigureOriginalPdfRequest('figure-1'), {
    documentHash: figure.documentHash,
    documentGeneration: 7
  });
});

test('sidebar closes its viewer state after PDF page navigation', () => {
  const body = functionSource('showFigureOriginalImage', popup);
  assert.match(body, /const panelContext = capturePanelContext\(\)/);
  assert.match(body, /Number\(tab\.id\) !== Number\(panelContext\.tabId\)/);
  assert.match(body, /!isCurrentPanelContext\(panelContext\)/);
  assert.match(body, /currentFigureOriginalPdfRequest\(figureId\)/);
  assert.match(body, /response\.mode === 'pdf-page'/);
  assert.match(body, /open:\s*!expectsPdfPageNavigation/);
  assert.match(body, /open:\s*!pdfPageNavigation/);
  assert.match(body, /figureId:\s*pdfPageNavigation \? ''/);
});
