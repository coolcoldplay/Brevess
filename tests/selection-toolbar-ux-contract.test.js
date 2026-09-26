const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'content.css'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const manualCss = css.slice(
  css.indexOf('/* Manual annotation UI: start */'),
  css.indexOf('/* Manual annotation UI: end */')
);
const toolbarSource = content.slice(
  content.indexOf('function showManualSelectionToolbar('),
  content.indexOf('\nfunction inspectManualSelection(',
    content.indexOf('function showManualSelectionToolbar('))
);

test('selection toolbar uses one compact visual contract for PDF and HTML', () => {
  const toolbarRule = manualCss.match(/#sci-manual-toolbar\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(toolbarRule, /width:\s*min\(520px,\s*calc\(100vw - 16px\)\)/);
  assert.match(toolbarRule, /max-height:\s*min\(48vh,\s*360px\)/);
  assert.match(toolbarRule, /overflow-x:\s*hidden/);
  assert.match(toolbarRule, /overflow-y:\s*auto/);
  assert.doesNotMatch(toolbarRule, /display:\s*none/);
  assert.doesNotMatch(manualCss, /brevess-pdf-reader[^\{]*#sci-manual-toolbar/);
});

test('selection toolbar is a locally scoped square, shadow-free compact Swiss surface', () => {
  const toolbarRule = manualCss.match(/#sci-manual-toolbar\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(toolbarRule, /border-radius:\s*0\s*;/);
  assert.match(toolbarRule, /box-shadow:\s*none\s*;/);
  assert.match(toolbarRule, /padding:\s*6px\s*;/);
  assert.match(toolbarRule, /font-size:\s*12px\s*;/);
  assert.match(css, /#sci-manual-toolbar :is\(button, select, input\)\s*\{[^}]*min-height:\s*28px[^}]*border-radius:\s*0/s);
  assert.match(css, /#sci-manual-toolbar \.sci-manual-abbreviation-panel\s*\{[^}]*border-radius:\s*0/s);
  assert.match(manualCss, /background-color:\s*var\(--sci-category-color/);
  assert.match(manualCss, /\.sci-manual-abbreviation-status\.is-error\s*\{[^}]*var\(--sci-manual-danger\)/s);
});

test('category and secondary action rows preserve every action in local horizontal scrollers', () => {
  assert.match(manualCss,
    /#sci-manual-toolbar \.sci-manual-primary-row,[\s\S]*?#sci-manual-toolbar \.sci-manual-secondary-row\s*\{[\s\S]*?flex-wrap:\s*nowrap[\s\S]*?overflow-x:\s*auto[\s\S]*?overflow-y:\s*hidden/);
  assert.match(manualCss,
    /#sci-manual-toolbar \.sci-manual-primary-row button,[\s\S]*?#sci-manual-toolbar \.sci-manual-secondary-row button\s*\{[\s\S]*?max-width:\s*190px[\s\S]*?overflow-wrap:\s*anywhere[\s\S]*?white-space:\s*normal/);
  assert.doesNotMatch(manualCss,
    /\.sci-manual-(?:primary|secondary)-row[^\{]*\{[^}]*display:\s*none/);
});

test('reading context, categories, rules, analysis, note, and abbreviation actions remain wired', () => {
  for (const contract of [
    "toolbar.id = 'sci-manual-toolbar'",
    "modeRow.className = 'sci-manual-mode-row'",
    "modeLabel.textContent = '阅读情境'",
    "primaryRow.className = 'sci-manual-primary-row'",
    "'sci-manual-category'",
    "ruleRow.className = 'sci-manual-rule-row'",
    "secondaryRow.className = 'sci-manual-secondary-row'",
    "'sci-manual-text-action sci-manual-llm-action'",
    "makeManualButton('高亮后写备注'",
    "'加入缩略词表'"
  ]) assert.ok(toolbarSource.includes(contract), `missing toolbar contract: ${contract}`);
  assert.match(toolbarSource, /currentManualSelectionActions[\s\S]*?action\.name/);
  assert.match(content,
    /async function runManualSelectionLlmAction[\s\S]*?askArticleWithLLM\([\s\S]*?ARTICLE_CHAT_OPEN_REQUESTED/);
  assert.match(toolbarSource, /toolbarCategories\.slice\(0, 8\)/);
});

test('rules and expanded editors remain bounded without hiding content', () => {
  assert.match(manualCss,
    /\.sci-manual-rule-row\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(150px, 1fr\) auto auto/);
  assert.match(manualCss,
    /\.sci-manual-more-panel,[\s\S]*?\.sci-manual-unresolved-list\s*\{[\s\S]*?max-height:\s*232px[\s\S]*?overflow-y:\s*auto/);
  assert.match(manualCss,
    /\.sci-manual-abbreviation-fields\s*\{[\s\S]*?grid-template-columns:/);
});

test('keyboard focus and reduced motion are explicit', () => {
  assert.match(manualCss,
    /#sci-manual-toolbar button:focus-visible,[\s\S]*?#sci-manual-toolbar select:focus-visible[\s\S]*?outline:\s*3px solid var\(--sci-manual-navy\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?#sci-manual-toolbar \*[\s\S]*?animation-duration:\s*\.001ms\s*!important[\s\S]*?transition-duration:\s*\.001ms\s*!important/);
});

test('720px and smaller screens retain a bounded usable toolbar', () => {
  assert.match(css,
    /@media \(max-width:\s*980px\)[\s\S]*?#sci-manual-toolbar\s*\{\s*width:\s*min\(520px,\s*calc\(100vw - 16px\)\)/);
  assert.match(css,
    /@media \(min-width:\s*561px\) and \(max-width:\s*980px\)[\s\S]*?\.sci-manual-rule-row\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(110px, 1fr\) auto auto/);
  assert.match(css,
    /@media \(max-width:\s*560px\)[\s\S]*?#sci-manual-toolbar\s*\{[\s\S]*?width:\s*calc\(100vw - 12px\)[\s\S]*?max-height:\s*min\(54vh,\s*420px\)/);
});
