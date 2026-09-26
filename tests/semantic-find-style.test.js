const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'semantic-find.css'), 'utf8');

test('semantic find uses square neutral chrome and a visible neutral keyboard focus', () => {
  for (const radius of css.matchAll(/border-radius:\s*([^;]+);/gu)) {
    assert.equal(radius[1], '0', 'panel, controls, and score legend use the square UI');
  }
  assert.match(css, /border:\s*1px solid #d5d5d5/u);
  assert.match(css, /color:\s*#202020/u);
  assert.match(css, /input:focus-visible\s*\{\s*outline:\s*2px solid #202020;\s*outline-offset:\s*1px/u);
  assert.match(css, /accent-color:\s*#202020/u, 'native range accent must not remain browser blue');
  assert.doesNotMatch(css, /#(?:b9c8d5|172532|176b9c|465b6c|536878|155f8c)\b/iu);
});

test('semantic find keeps geometry, score gradient, statuses, and disabled affordance', () => {
  assert.match(css, /width:\s*min\(430px, calc\(100vw - 28px\)\)/u);
  assert.match(css, /min-height:\s*32px/u);
  assert.match(css, /\.sci-semantic-find__threshold\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(56px, 1fr\) 58px/u);
  assert.match(css, /input\[type="range"\]\s*\{\s*width:\s*100%;\s*min-width:\s*0/u);
  assert.match(css, /input\[type="number"\]\s*\{\s*width:\s*100%;\s*min-width:\s*0/u);
  assert.match(css, /button:disabled\s*\{\s*cursor:\s*default;\s*opacity:\s*\.48/u);
  assert.match(css, /background:\s*linear-gradient\(90deg, rgba\(255, 187, 35, \.18\), rgba\(255, 187, 35, \.88\)\)/u);
  assert.match(css, /\[data-state="error"\]\s*\{\s*color:\s*#a13434/u);
  assert.match(css, /\[data-state="success"\]\s*\{\s*color:\s*#28724b/u);
  assert.match(css, /@media \(max-width: 460px\)/u);
});
