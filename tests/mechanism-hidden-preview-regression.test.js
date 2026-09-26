const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderMechanismDiagramInMeasurableHost
} = require('../core/mechanism-pending-preview.js');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = new Map();
    this.hidden = false;
    this.viewBox = null;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }

  insertBefore(node, reference) {
    node.remove();
    const index = this.children.indexOf(reference);
    if (index < 0) throw new Error('reference is not a child');
    node.parentNode = this;
    this.children.splice(index, 0, node);
    return node;
  }

  replaceChild(node, previous) {
    const index = this.children.indexOf(previous);
    if (index < 0) throw new Error('previous is not a child');
    node.remove();
    previous.parentNode = null;
    node.parentNode = this;
    this.children[index] = node;
    return previous;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) || null;
  }

  querySelector(selector) {
    if (selector === 'svg') return this.children.find(child => child.tagName === 'SVG') || null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '[d], [transform]') return this.geometryNodes || [];
    return [];
  }
}

function installFakeDocument() {
  const previous = global.document;
  const body = new FakeElement('body');
  global.document = {
    body,
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };
  return () => {
    if (previous === undefined) delete global.document;
    else global.document = previous;
  };
}

function validSvg() {
  const svg = new FakeElement('svg');
  svg.viewBox = { baseVal: { width: 720, height: 360 } };
  const group = new FakeElement('g');
  group.setAttribute('transform', 'translate(20, 20)');
  svg.geometryNodes = [group];
  return svg;
}

test('hidden parent renders in a fixed measurable host and reattaches finite output', async () => {
  const restoreDocument = installFakeDocument();
  try {
    const parent = new FakeElement('section');
    parent.hidden = true;
    const diagram = new FakeElement('div');
    parent.append(diagram);
    let initialized;
    let stagingDuringRun;
    const mermaid = {
      initialize(options) { initialized = options; },
      async run({ nodes }) {
        stagingDuringRun = nodes[0].parentNode;
        nodes[0].append(validSvg());
      }
    };

    assert.equal(await renderMechanismDiagramInMeasurableHost(diagram, { mermaid }), true);
    assert.equal(stagingDuringRun.style.width, '960px');
    assert.equal(stagingDuringRun.parentNode, null, 'staging must be removed after render');
    assert.equal(diagram.parentNode, parent, 'rendered diagram returns to its hidden owner');
    assert.equal(parent.children.length, 1, 'placeholder must be replaced exactly once');
    assert.equal(initialized.securityLevel, 'strict');
    assert.equal(initialized.flowchart.htmlLabels, false);
    assert.equal(initialized.theme, 'base');
  } finally {
    restoreDocument();
  }
});

test('removing the placeholder while Mermaid runs discards stale output', async () => {
  const restoreDocument = installFakeDocument();
  try {
    const parent = new FakeElement('section');
    const diagram = new FakeElement('div');
    parent.append(diagram);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const mermaid = {
      initialize() {},
      async run({ nodes }) {
        await gate;
        nodes[0].append(validSvg());
      }
    };

    const rendering = renderMechanismDiagramInMeasurableHost(diagram, { mermaid });
    const placeholder = parent.children.find(child =>
      child.className === 'mechanism-diagram-render-placeholder');
    assert.ok(placeholder, 'render must leave an ownership placeholder');
    placeholder.remove();
    release();

    assert.equal(await rendering, true);
    assert.equal(diagram.parentNode, null, 'stale output must not return to the old parent');
    assert.equal(global.document.body.children.length, 0, 'staging must always be cleaned');
  } finally {
    restoreDocument();
  }
});

test('a disconnected ordinary render returns to its original section', async () => {
  const restoreDocument = installFakeDocument();
  try {
    const section = new FakeElement('section');
    const diagram = new FakeElement('div');
    section.append(diagram);
    const mermaid = {
      initialize() {},
      async run({ nodes }) { nodes[0].append(validSvg()); }
    };

    assert.equal(section.parentNode, null);
    assert.equal(await renderMechanismDiagramInMeasurableHost(diagram, { mermaid }), true);
    assert.equal(diagram.parentNode, section);
    assert.equal(diagram.querySelector('svg').viewBox.baseVal.width, 720);
    assert.equal(global.document.body.children.length, 0);
  } finally {
    restoreDocument();
  }
});

