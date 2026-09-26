const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
test('NOTE015 places one icon-only whole-note toggle next to Markdown export', () => {
  const html = read('popup.html');
  assert.match(html, /id="exportLiteratureNoteMarkdown"[^>]*>导出 Markdown<\/button>\s*<button id="toggleLiteratureNoteMarkdown"/);
  const button = html.match(/<button id="toggleLiteratureNoteMarkdown"[\s\S]*?<\/button>/)?.[0];
  assert.ok(button);
  assert.match(button, /aria-label=/); assert.match(button, /<svg/);
  assert.doesNotMatch(button.replace(/<[^>]*>/g, '').trim(), /\S/);
});
test('NOTE015 uses the existing safe editor renderer with an external preview API', () => {
  const editor = read('core/literature-note-editor.js');
  assert.match(editor, /function setPreview\(/);
  assert.match(editor, /canSetPreview/);
  assert.match(editor, /if \(showToggle\) toolbar.appendChild\(toggle\)/);
  const popup = read('popup.js');
  assert.match(popup, /let literatureNotePreviewing = true/);
  assert.match(popup, /showToggle: false/);
  assert.match(popup, /initialPreview: literatureNotePreviewing/);
});
test('NOTE015 mode switch does not route through persistence or rewrite note source values', () => {
  const popup = read('popup.js');
  const fn = popup.match(/function setLiteratureNotePreview\([\s\S]*?\n}\n/)?.[0];
  assert.ok(fn, 'global mode controller must exist');
  assert.match(fn, /canSetPreview/); assert.match(fn, /setPreview/);
  assert.doesNotMatch(fn, /\.value\s*=|persistLiterature|\.valuesByTemplate|dispatchEvent/);
});
