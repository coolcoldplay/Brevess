const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'ui-swiss.css'), 'utf8');
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }));
const noticeRules = rules.filter(rule => rule.selector.includes('.side-panel-global-status'));

test('only the sidebar global notice receives the quiet square strip treatment', () => {
  const base = noticeRules.find(rule => rule.selector === '[data-ui-surface="sidebar"] .side-panel-global-status');
  assert.ok(base, 'scoped global notice rule must exist');
  for (const pattern of [/border-radius:\s*0;/, /box-shadow:\s*none;/,
    /background:\s*var\(--swiss-soft\);/, /color:\s*var\(--swiss-ink\);/,
    /text-align:\s*left;/, /overflow-wrap:\s*anywhere;/, /min-width:\s*0;/]) assert.match(base.body, pattern);
  assert.ok(noticeRules.every(rule => rule.selector.includes('[data-ui-surface="sidebar"]')));
});

test('notice CSS leaves visibility and lifecycle to the existing status controller', () => {
  assert.ok(noticeRules.length > 0);
  for (const rule of noticeRules) assert.doesNotMatch(rule.body, /(?:display|visibility|opacity|content)\s*:|!important/);
});

test('semantic status uses edge accents, with active Figure work distinct from completed success', () => {
  for (const kind of ['success', 'warning', 'error']) {
    const rule = noticeRules.find(rule => rule.selector === `[data-ui-surface="sidebar"] .side-panel-global-status.${kind}`);
    assert.ok(rule, `${kind} edge rule must exist`);
    assert.match(rule.body, /border-inline-start-color:/);
    assert.doesNotMatch(rule.body, /(?:^|;)\s*(?:background(?:-color)?|color)\s*:/);
  }
  assert.ok(noticeRules.some(rule => rule.selector.includes(':has(#analyzeFiguresFromFigures[aria-busy="true"])') &&
    rule.selector.endsWith('.side-panel-global-status.success') && /border-inline-start-color:\s*var\(--swiss-ink\)/.test(rule.body)));
});
