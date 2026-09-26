const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const code = source.slice(source.indexOf('function isPageShortcutEditableTarget('),
  source.indexOf("document.addEventListener('keydown', handleSidePanelGlobalShortcut"));

function fixture() {
  class Element {
    constructor(editable = false) { this.editable = editable; }
    closest() { return this.editable ? this : null; }
  }
  let opened = 0;
  const context = { Element, getFigureImageViewerState: () => ({ open: false }),
    sidePanelShortcutScope: { enabled: false }, __brevessSemanticFind: {
      handleKeydown: () => false, shortcutKey: 'J', open: () => { opened += 1; }
    } };
  vm.runInNewContext(code, context);
  return { Element, context, opened: () => opened };
}

test('hot J does not consume editable targets hidden behind open shadow retargeting', () => {
  const f = fixture();
  const host = new f.Element();
  for (const path of [[new f.Element(true), host], [host, new f.Element(true)]]) {
    let consumed = false;
    f.context.handleSidePanelGlobalShortcut({ key: 'j', target: host, composedPath: () => path,
      preventDefault() { consumed = true; }, stopImmediatePropagation() { consumed = true; } });
    assert.equal(consumed, false);
  }
  assert.equal(f.opened(), 0);
});

test('hot J still opens without sidebar and protects normal editable / composing input', () => {
  const f = fixture();
  let consumed = 0;
  const event = { key: 'j', target: new f.Element(), preventDefault() { consumed += 1; },
    stopImmediatePropagation() {} };
  f.context.handleSidePanelGlobalShortcut({ ...event, target: new f.Element(true) });
  f.context.handleSidePanelGlobalShortcut({ ...event, isComposing: true });
  assert.equal(consumed, 0);
  f.context.handleSidePanelGlobalShortcut(event);
  assert.equal(consumed, 1);
  assert.equal(f.opened(), 1);
});
