const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('local reading library is the first local-data surface and maintenance stays available', () => {
  const html = read('options.html');
  const library = html.indexOf('id="localReadingLibrary"');
  const overview = html.indexOf('id="articleWorkspaceOverview"');
  assert.ok(library >= 0 && overview > library);
  assert.match(html, /<details[^>]+class="[^"]*local-data-maintenance/s);
  assert.match(html, /维护、同步与迁移/);
  for (const id of [
    'articleWorkspaceOverview', 'directorySyncSettings', 'exportMigrationBundle',
    'importMigrationBundle', 'exportCorpusJsonl', 'distillRules'
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

test('library search gives the query primary width and reports scope coverage', () => {
  const js = read('options-local-library.js');
  const css = read('options-local-library.css');
  assert.match(js, /local-library__search-field/);
  assert.match(js, /local-library__scope-field/);
  assert.match(js, /dataset\.libraryScopeSummary/);
  assert.match(js, /当前范围：/);
  assert.match(css, /local-library__controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*3fr\)\s+minmax\([^,]+,\s*1fr\)/s);
});

test('library tabs implement roving keyboard focus without changing query semantics', () => {
  const js = read('options-local-library.js');
  assert.match(js, /ArrowLeft/);
  assert.match(js, /ArrowRight/);
  assert.match(js, /tabIndex\s*=\s*selected\s*\?\s*0\s*:\s*-1/);
  assert.match(js, /state\.kind\s*=\s*nextKind/);
  assert.match(js, /load\(root\)/);
});

test('glossary preserves every data field while prioritizing readable text and status', () => {
  const js = read('options-local-library.js');
  const css = read('options-local-library.css');
  for (const className of [
    'local-library__full-name', 'local-library__meaning', 'local-library__date',
    'local-library__number', 'local-library__visibility-status'
  ]) assert.match(js, new RegExp(className));
  assert.match(js, /查看出现文献/);
  assert.match(js, /hiddenFromReading[^\n]+\?\s*'隐藏'\s*:\s*'显示'/);
  assert.match(css, /local-library__date[^}]*white-space:\s*nowrap/s);
  assert.match(css, /local-library__full-name[^}]*white-space:\s*normal/s);
  assert.match(css, /local-library__table\s*\{[^}]*min-width:/s);
});

test('mechanism workspace exposes direct graph evidence and pending-preview navigation', () => {
  const html = read('popup.html');
  const js = read('popup.js');
  for (const region of [
    'saved-graph', 'saved-evidence', 'pending-graph', 'pending-evidence',
    'pending-unresolved'
  ]) {
    assert.match(html, new RegExp(`data-mechanism-region="${region}"`));
  }
  assert.match(js, /mechanismGraphRegion/);
  assert.match(js, /mechanismEvidenceRegion/);
  assert.match(js, /mechanismPendingGraphRegion/);
  assert.match(js, /mechanismPendingEvidenceRegion/);
  assert.match(js, /mechanismPendingUnresolvedRegion/);
  assert.match(js, /scrollIntoView\(\{\s*behavior:\s*'smooth',\s*block:\s*'start'/s);
  assert.match(js, /target\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
});

test('mechanism graph has a bounded viewport plus fit and restore controls', () => {
  const js = read('popup.js');
  const css = read('popup.css');
  assert.match(js, /dataset\.mechanismViewReset/);
  assert.match(js, /恢复视图/);
  assert.match(js, /scrollTo\?\.\(\{\s*left:\s*0,\s*top:\s*0/s);
  assert.match(css, /workspace-mechanism-mermaid\s*\{[^}]*max-height:\s*clamp\(/s);
  assert.match(css, /workspace-mechanism-mermaid\s*\{[^}]*overflow:\s*auto/s);
});

test('pending mechanism preview receives its own graph controls and three direct anchors', () => {
  const js = read('popup.js');
  const start = js.indexOf('function prepareMechanismPendingPreviewNavigation(');
  assert.ok(start >= 0);
  const end = js.indexOf('\nfunction ', start + 20);
  const source = js.slice(start, end < 0 ? undefined : end);
  assert.match(source, /\.mechanism-pending-preview-evidence/);
  assert.match(source, /\.mechanism-pending-preview-nonrelation/);
  assert.match(source, /createMechanismMermaidViewControls/);
  assert.match(source, /mechanismPendingGraphRegion/);
  assert.match(source, /mechanismPendingEvidenceRegion/);
  assert.match(source, /mechanismPendingUnresolvedRegion/);
});
