const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pdf-reader.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pdf-reader.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'pdf-reader-ui.js'), 'utf8');

test('native browser selection uses a low-obstruction system-blue treatment', () => {
  assert.match(css,
    /\.pdf-native-text-layer::selection,[\s\S]*?\.pdf-native-text-layer span::selection\s*\{[\s\S]*?background:\s*rgb\(24 119 242 \/ 22%\)/);
});

test('persistent, automatic, and rule annotations avoid heavy full-line fills', () => {
  const saved = css.match(/\.pdf-native-annotation-hit\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(saved, /background:\s*color-mix\([^;]+8%,\s*transparent\)/);
  assert.match(saved, /inset 0 -2px 0/);
  assert.match(saved, /inset 0 0 0 1px/);
  assert.doesNotMatch(saved, /(?:3[0-9]|4[0-9]|[5-9][0-9])%,\s*transparent/);
  assert.match(css,
    /\.pdf-native-automatic-hit\.sci-llm-highlight\s*\{[\s\S]*?background:\s*color-mix\([^;]+7%,\s*transparent\)[\s\S]*?inset 0 -2px 0/);
  assert.match(css,
    /\.pdf-native-regex-hit\s*\{[\s\S]*?background:\s*color-mix\([^;]+5%,\s*transparent\)[\s\S]*?inset 0 -2px 0/);
});

test('saved annotation remains clickable and has clear focus and forced-color boundaries', () => {
  assert.match(css, /\.pdf-native-annotation-hit\s*\{[\s\S]*?pointer-events:\s*auto/);
  assert.match(css,
    /\.pdf-native-annotation-hit:hover,[\s\S]*?\.pdf-native-annotation-hit:focus-visible\s*\{[\s\S]*?outline:\s*3px solid/);
  assert.match(css,
    /@media \(forced-colors:\s*active\)[\s\S]*?\.pdf-native-annotation-hit[\s\S]*?background:\s*transparent[\s\S]*?box-shadow:\s*inset 0 -2px 0 Highlight/);
});

test('progress is hidden by default and becomes determinate only from real page counts', () => {
  assert.match(html,
    /class="pdf-reader-progress"[^>]+role="progressbar"[^>]+aria-hidden="true"[^>]+hidden/);
  assert.match(ui, /state === 'loading' \|\| state === 'indexing'/);
  assert.ok(ui.includes("message.match(/(?:已检查\\s*)?(\\d+)\\s*\\/\\s*(\\d+)\\s*页/u)"));
  assert.match(ui, /readerControl\.dataset\.progressKind = measured \? 'measured' : \(active \? 'stage' : 'settled'\)/);
  assert.match(ui, /readerProgress\.hidden = !measured/);
  assert.match(ui, /readerProgressBar\.style\.width = `\$\{measured\.percent\}%`/);
});

test('terminal errors stay out of the reading area while retaining recovery controls', () => {
  assert.match(css, /\.pdf-reader-control\[data-state="error"\] \.pdf-reader-progress/);
  assert.match(css,
    /\.pdf-reader-control\[data-state="error"\],[\s\S]*?\.pdf-reader-control\[data-state="error"\] \*\s*\{[\s\S]*?animation:\s*none\s*!important/);
  assert.match(css,
    /\.pdf-reader-notice-stack\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(html, /id="pdfReaderRetry"[^>]+type="button"[^>]+hidden/);
});

test('responsive controls and reduced motion remain explicit', () => {
  for (const id of ['pdfReaderStudy', 'pdfReaderZoomOut', 'pdfReaderZoomIn',
    'pdfReaderZoomReset', 'pdfReaderFocusToggle', 'pdfReaderMoreToggle',
    'pdfReaderPageNumber', 'pdfReaderFind']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /@media \(max-width:\s*760px\)/);
  assert.match(css, /@media \(max-width:\s*560px\)/);
  assert.match(css,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.pdf-reader-progress span[\s\S]*?transition:\s*none\s*!important/);
});
