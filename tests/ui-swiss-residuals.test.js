const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname,'..','ui-swiss.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1].trim(),body:m[2]}));
function requireRule(selector, property, value) {
  assert.ok(rules.some(rule=>rule.selector.includes(selector)&&
    new RegExp(property+'\\s*:\\s*'+value+'\\s*(?:;|$)').test(rule.body)),
  selector+' must explicitly define '+property+': '+value);
}
test('reached Figure and evidence containers opt into the square skin',()=>{
  for(const selector of ['.workspace-logic-map-card','.workspace-figure-overview','.workspace-evidence-block',
    '.workspace-evidence-direction','.workspace-evidence-orphans','.workspace-panel-followup-answer',
    '.workspace-panel-followup-history','.figure-panel-header-fields-menu','.figure-quick-nav-panel-popover'])
    requireRule(selector,'border-radius','0');
});
test('Figure group color belongs to identifiers and edges, not entire page cards',()=>{
  requireRule('.workspace-figure-panel-card','background','#fff');
  requireRule('.workspace-evidence-block-summary','background','var\\(--swiss-soft\\)');
  assert.ok(!rules.some(rule=>/\.workspace-panel-id\[data-evidence-group/.test(rule.selector)&&/background\s*:/.test(rule.body)));
});
test('mechanism chrome and menus use bounded neutral square surfaces',()=>{
  for(const selector of ['.workspace-mechanism-mermaid-section','.workspace-mechanism-matrix-section',
    '.workspace-mechanism-matrix-scroll','.workspace-mechanism-export-menu','.workspace-mechanism-matrix-cell-editor',
    '.workspace-mechanism-section-nav'])
    requireRule(selector,'border-radius','0');
  requireRule('.workspace-mechanism-matrix-cell-editor','box-shadow','none');
  requireRule('.workspace-mechanism-toolbar','background','#fff');
});
test('non-focus mechanism subview retains the bottom navigation without changing focus mode',()=>{
  requireRule('.side-panel-app.is-mechanism-view:not(.is-sidebar-focus-mode) .workspace-bottom-nav','display','grid');
  assert.ok(!rules.some(rule=>rule.selector.includes('.is-sidebar-focus-mode')&&
    !rule.selector.includes(':not(.is-sidebar-focus-mode)')&&/display\s*:\s*grid/.test(rule.body)));
});
test('semantic state and scientific rendering are not erased by blanket resets',()=>{
  assert.doesNotMatch(css, /\*\s*\{[^}]*border-radius/);
  assert.ok(!rules.some(rule=>/\.sci-highlight|\.pdfViewer|\.textLayer|\.annotationLayer/.test(rule.selector)));
  assert.ok(!rules.some(rule=>/\.is-(sufficiency|necessity|contested|correlation-only)/.test(rule.selector)&&/\bcolor\s*:/.test(rule.body)));
  assert.doesNotMatch(css,/border-radius\s*:\s*0\s*!important/);
});
test('revealed answer movement has no old blue flash or shadow pulse',()=>{
  requireRule('.workspace-panel-followup-answer.is-newly-revealed','animation','none');
});
test('reading expanded surfaces and progress frames opt into the square skin',()=>{
  for(const selector of ['.workspace-paragraph-list','.workspace-distribution-cell',
    '.workspace-distribution-occurrences','.workspace-pdf-native-baseline',
    '.article-chat-answer-block','.article-chat-message','.article-chat-markdown-table-wrap',
    '.article-workspace-save-progress','.article-workspace-save-stage','.confidence-control','.llm-diagnostics'])
    requireRule(selector,'border-radius','0');
});
test('settings non-button controls and expanded secondary surfaces are covered',()=>{
  for(const selector of ['.rail-count','.settings-panel label.button','.category-workspace label.button','.migration-import-label',
    '.task-token-preview','.article-workspace-token-usage','.article-workspace-state',
    '.local-library__article-open'])
    requireRule(selector,'border-radius','0');
});
test('narrow settings token usage does not retain fixed minimum two-column tracks',()=>{
  requireRule('.article-workspace-token-feature','grid-template-columns','minmax\\(0, 1fr\\)');
});
test('PDF source entry inputs opt into the chrome skin, without changing invalid states',()=>{
  for(const selector of ['.pdf-reader-local-fallback input[type="file"]','.pdf-reader-remote-source input[type="url"]'])
    requireRule(selector,'border-radius','0');
});
