const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const reader = fs.readFileSync(path.join(root, 'pdf-native-reader.mjs'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pdf-reader.css'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must be declared`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete body`);
}

function makeSpan(textContent, childElementCount = 0, marked = false) {
  const attributes = new Set(marked ? ['data-pdf-whitespace-selection'] : []);
  return {
    textContent,
    childElementCount,
    geometry: Object.freeze({ left: 17, top: 29, width: 31, height: 0 }),
    toggleAttribute(name, force) {
      if (force) attributes.add(name);
      else attributes.delete(name);
    },
    hasAttribute(name) {
      return attributes.has(name);
    }
  };
}

test('native PDF selection makes only pure-whitespace leaf span backgrounds transparent', () => {
  const helperSource = extractFunction(reader, 'markPdfWhitespaceSelectionLeaves');
  const context = vm.createContext({});
  vm.runInContext(`${helperSource}; this.mark = markPdfWhitespaceSelectionLeaves;`, context);

  const space = makeSpan(' ');
  const unicodeWhitespace = makeSpan('\t\n\u00a0');
  const text = makeSpan('2026-09-19', 0, true);
  const empty = makeSpan('');
  const parent = makeSpan('  ', 1);
  const spans = [space, unicodeWhitespace, text, empty, parent];
  const before = spans.map(span => ({
    identity: span,
    textContent: span.textContent,
    geometry: span.geometry
  }));
  const layer = {
    querySelectorAll(selector) {
      assert.equal(selector, 'span');
      return spans;
    }
  };

  context.mark(layer);

  assert.deepEqual(
    spans.map(span => span.hasAttribute('data-pdf-whitespace-selection')),
    [true, true, false, false, false]
  );
  assert.deepEqual(spans.map((span, index) => ({
    identity: span,
    textContent: span.textContent,
    geometry: span.geometry
  })), before, 'marking must preserve node order, identity, text, and geometry');

  space.textContent = 'visible';
  context.mark(layer);
  assert.equal(space.hasAttribute('data-pdf-whitespace-selection'), false,
    'repeat marking must remove a stale marker from a reused non-whitespace span');

  assert.match(reader,
    /await layer\.render\(\)[\s\S]*?if \(!current\(\) \|\| record\.textLayer !== ownedLayer\) return false;[\s\S]*?markPdfWhitespaceSelectionLeaves\(ownedLayer\);/,
    'marking must happen only after TextLayer render and its ownership check');

  const selector = String.raw`\.pdf-native-text-layer span\[data-pdf-whitespace-selection\]::selection`;
  const normalRule = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] || '';
  assert.match(normalRule, /background:\s*transparent\s*;/);
  assert.doesNotMatch(normalRule, /user-select\s*:/);
  assert.match(css, new RegExp(
    `@media \\(forced-colors:\\s*active\\)[\\s\\S]*?${selector}\\s*\\{[^}]*background:\\s*transparent\\s*;`
  ));
  assert.doesNotMatch(css, new RegExp(`${selector}\\s*\\{[^}]*user-select\\s*:`));
});
