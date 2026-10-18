'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source.js');

const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function clock() {
  let now = 0, next = 0;
  const jobs = new Map();
  return {
    setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const item = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
        if (!item || item[1].at > end) break;
        now = item[1].at;
        jobs.delete(item[0]);
        item[1].fn();
      }
      now = end;
    }
  };
}

function harness() {
  const timers = clock(), edits = [], summaries = [], focuses = [], statuses = [];
  const element = () => {
    const listeners = new Map();
    return {
      dataset: {}, isConnected: true, disabled: false, classList: { add() {} },
      addEventListener(type, fn) { listeners.set(type, fn); },
      fire(type, props = {}) {
        const event = { detail: 1, preventDefault() {}, stopImmediatePropagation() {}, ...props };
        listeners.get(type)?.(event);
        return event;
      }
    };
  };
  const snapshot = { documentId: 'doc-a', documentHash: 'hash-a', revision: 3 };
  const state = new Map();
  const context = vm.createContext({
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, Promise,
    outlineRenderGeneration: 1, paragraphSummaryTaskGeneration: 1,
    currentWorkspaceSnapshot: snapshot, currentPdfSemanticNavigation: null,
    workspaceParagraphSummaryState: state,
    capturePanelContext: taskToken => ({ key: 'panel-a', taskToken }),
    isCurrentPanelContext: value => value.key === 'panel-a',
    isCurrentParagraphSummaryTask: value => value.key === 'panel-a' &&
      value.taskToken === context.paragraphSummaryTaskGeneration,
    outlineSourceDocumentIdentity: value => JSON.stringify([value?.documentId, value?.documentHash]),
    openParagraphNoteEditor: (paragraph, value) => edits.push({ paragraph, snapshot: value }),
    runParagraphSummaryAppend: (paragraph, panelContext) => {
      summaries.push({ paragraph, panelContext });
      state.set(paragraph.paragraphId, { loading: true });
    },
    focusWorkspaceSource: async target => { focuses.push(target); return true; },
    showStatus: (message, kind) => statuses.push({ message, kind })
  });
  vm.runInContext(['paragraphJumpTarget', 'bindParagraphNoteGestures',
    'bindParagraphMarkerGestures'].map(name => functionSource(popup, name)).join('\n'), context);
  return { context, timers, snapshot, element, edits, summaries, focuses, statuses,
    state, bindText(button, paragraph) {
      context.bindParagraphNoteGestures(button, paragraph, snapshot, { sourceIsCurrent: () => true });
    },
    bindMarker(marker, paragraph) {
      context.bindParagraphMarkerGestures(marker, paragraph, snapshot, { sourceIsCurrent: () => true });
    }
  };
}

test('R34 paragraph text opens the note editor on the first click without waiting for a double-click', () => {
  const h = harness(), button = h.element(), paragraph = { paragraphId: 'p1', sourceKey: 's1', text: 'Body' };
  h.bindText(button, paragraph);
  button.fire('click', { detail: 1 });
  assert.equal(h.edits.length, 1);
  button.fire('click', { detail: 2 });
  assert.equal(h.edits.length, 1, 'the second click of a double click must not reopen the editor');
  assert.equal(h.summaries.length, 0);
});

test('R34 the color marker jumps on one click and generates only on double click', () => {
  const h = harness(), marker = h.element(), paragraph = { paragraphId: 'p1', sourceKey: 's1',
    text: 'Body paragraph', navigationRevision: 3 };
  h.bindMarker(marker, paragraph);
  marker.fire('click', { detail: 1 });
  assert.equal(h.focuses.length, 0);
  h.timers.advance(259);
  assert.equal(h.focuses.length, 0);
  h.timers.advance(1);
  assert.equal(h.focuses.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.focuses[0])), { kind: 'paragraph',
    paragraphId: 'p1', sourceKey: 's1', quote: 'Body paragraph', navigationRevision: 3 });
  marker.fire('click', { detail: 1 });
  h.timers.advance(80);
  marker.fire('click', { detail: 2 });
  marker.fire('dblclick', { detail: 2 });
  h.timers.advance(1000);
  assert.equal(h.focuses.length, 1, 'double click must cancel the pending jump');
  assert.equal(h.summaries.length, 1);
  assert.equal(h.summaries[0].paragraph.paragraphId, 'p1');
});

test('R34 marker keyboard activation jumps, Shift+Enter summarizes, and a stale marker is inert', async () => {
  const h = harness(), marker = h.element(), paragraph = { paragraphId: 'p1', sourceKey: 's1', text: 'Body' };
  h.bindMarker(marker, paragraph);
  marker.fire('click', { detail: 0 });
  await tick();
  assert.equal(h.focuses.length, 1);
  marker.fire('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(h.summaries.length, 1);
  marker.isConnected = false;
  marker.fire('click', { detail: 0 });
  await tick();
  assert.equal(h.focuses.length, 1);
  assert.equal(h.summaries.length, 1);
});

test('R34 the PDF marker carries the complete semantic target and the HTML marker does not invent one', () => {
  const h = harness();
  const semantic = { kind: 'paragraph', paragraphId: 'pdf-p1', documentId: 'doc-a',
    documentHash: 'hash-a', revision: 7, expectedNormalizedQuote: 'Exact PDF quote',
    normalizedStart: 10, normalizedEnd: 25 };
  const pdf = h.context.paragraphJumpTarget({ paragraphId: 'pdf-p1', sourceKey: 'pdf-p1',
    text: 'Fallback', semanticTarget: semantic });
  assert.equal(pdf.documentId, 'doc-a');
  assert.equal(pdf.expectedNormalizedQuote, 'Exact PDF quote');
  assert.equal(pdf.quote, 'Exact PDF quote');
  const html = h.context.paragraphJumpTarget({ paragraphId: 'p1', sourceKey: 's1', text: 'HTML body' });
  assert.deepEqual(JSON.parse(JSON.stringify(html)), { kind: 'paragraph', paragraphId: 'p1',
    sourceKey: 's1', quote: 'HTML body', navigationRevision: 0 });
});

test('R34 both renderers append the marker before the edit card and remove legacy action buttons', () => {
  for (const name of ['renderPopupPdfSemanticNavigation', 'renderArticleNavigationTree']) {
    const source = functionSource(popup, name);
    assert.match(source, /workspace-paragraph-marker/);
    assert.match(source, /button\.append\(marker, text\)/);
    assert.match(source, /row\.append\(button\)/);
    assert.equal(source.includes("'workspace-paragraph-note-action'"), false);
    assert.equal(source.includes("'workspace-paragraph-summary-action'"), false);
  }
});

test('R34 paragraph marker uses the compact Figure/Panel badge language instead of a standalone amber bar', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'popup.css'), 'utf8');
  const block = css.match(/^\.workspace-paragraph-marker\s*\{([^}]*)\}/m)?.[1] || '';
  assert.match(block, /background:\s*#dfedf8/i);
  assert.match(block, /color:\s*#183a57/i);
  assert.match(block, /border-radius:\s*3px/i);
  assert.match(block, /min-width:\s*32px/i);
  assert.match(block, /height:\s*18px/i);
  assert.match(block, /vertical-align:\s*-3px/i);
  assert.doesNotMatch(block, /linear-gradient/i);
  assert.match(css, /^\.workspace-paragraph-text\s*\{\s*display:\s*inline/m);
  const source = functionSource(popup, 'renderArticleNavigationTree');
  assert.match(source, /`段\$\{index \+ 1\}`/);
  const swiss = fs.readFileSync(path.join(__dirname, '..', 'ui-swiss.css'), 'utf8');
  assert.match(swiss, /#articleNavigationTree :is\(\.workspace-paragraph-row, \.workspace-pdf-paragraph-row\)\s*\{\s*display:\s*block/);
});
