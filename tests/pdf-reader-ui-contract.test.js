const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pdf-reader.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pdf-reader.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'pdf-reader-ui.js'), 'utf8');

const legacyIds = [
  'pdfReaderSubtitle', 'pdfReaderStudy', 'pdfReaderZoomOut', 'pdfReaderZoomValue',
  'pdfReaderZoomIn', 'pdfReaderZoomReset', 'pdfReaderJumpBack',
  'pdfReaderReturnToArticle', 'pdfReaderViewToggle', 'pdfReaderStartParse',
  'pdfReaderReparse', 'pdfReaderSaveAnnotated', 'pdfReaderOverwriteAnnotated',
  'pdfReaderOpenOriginalTab', 'pdfReaderSettingsToggle', 'pdfReaderPreviousPage',
  'pdfReaderPageNumber', 'pdfReaderPageCount', 'pdfReaderNextPage', 'pdfReaderFind',
  'pdfReaderFindPrevious', 'pdfReaderFindNext', 'pdfReaderFindStatus',
  'pdfMineruQuotaStatus', 'pdfFigureEngineStatus', 'pdfReaderSaveStatus',
  'pdfReaderControl', 'pdfReaderStatusTitle', 'pdfReaderStatus',
  'pdfReaderProgressBar', 'pdfReaderRetry', 'pdfReaderOpenSettings',
  'pdfLocalFileFallback', 'pdfLocalFile', 'pdfRemoteUrl', 'pdfRemoteUrlOpen',
  'pdfRemoteUrlStatus', 'pdfLocalFilePicker', 'pdfOriginalViewer',
  'pdfNativeViewer', 'pdfOriginalFrame', 'pdfReaderWorkspace', 'pdfReaderPage',
  'pdfReaderArticle'
];

test('compact reader preserves every established PDF DOM integration id', () => {
  for (const id of legacyIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing established #${id}`);
  }
});

test('toolbar uses the bundled icon and exposes primary, focus, and accessible overflow controls', () => {
  assert.match(html, /<img[^>]+class="pdf-reader-mark"[^>]+src="icons\/icon48\.png"/);
  assert.match(html, /id="pdfReaderStudy"/);
  assert.match(html, /id="pdfReaderFocusToggle"[^>]+aria-pressed="false"[^>]+aria-keyshortcuts="Escape"/);
  assert.match(html, /id="pdfReaderMoreToggle"[^>]+aria-expanded="false"[^>]+aria-controls="pdfReaderMoreMenu"[^>]+aria-haspopup="menu"/);
  assert.match(html, /id="pdfReaderMoreMenu"[^>]+role="menu"[^>]+hidden/);
  for (const id of ['pdfReaderStartParse', 'pdfReaderReparse', 'pdfReaderSaveAnnotated',
    'pdfReaderOverwriteAnnotated', 'pdfReaderOpenOriginalTab', 'pdfReaderSettingsToggle']) {
    assert.match(html, new RegExp(`id=["']${id}["'][\\s\\S]{0,180}role=["']menuitem["']|role=["']menuitem["'][\\s\\S]{0,180}id=["']${id}["']`));
  }
});

test('status surfaces remain live, truthful DOM owned by the existing controller', () => {
  assert.match(html, /id="pdfReaderNoticeStack"[^>]*\shidden(?:\s|>)/,
    'status is owned by the sidebar and must never take PDF reading space');
  assert.match(ui, /noticeStack\.hidden = true/);
  for (const id of ['pdfMineruQuotaStatus', 'pdfFigureEngineStatus', 'pdfReaderSaveStatus']) {
    assert.match(html, new RegExp(`id=["']${id}["'][^>]+role=["']status["'][^>]+aria-live=["']polite["']`));
  }
  assert.match(ui, /pdfEnhancementState/);
  assert.match(ui, /pdfEnhancementError/);
  assert.match(ui, /pdfWorkspaceIndexError/);
  assert.doesNotMatch(ui, /pdfEnhancementState\s*=/);
  assert.doesNotMatch(ui, /pdfWorkspaceIndexError\s*=/);
  assert.doesNotMatch(ui, /nativeViewer\.dataset\.state\s*=/);
  assert.match(ui, /nativeState === 'ready'/);
  assert.match(ui, /originalVisible && nativeState === 'ready'/);
});

test('focus mode, no inline notices, native hint suppression, and reduced motion are styled', () => {
  assert.match(css, /\.pdf-reader-notice-stack\s*\{[\s\S]*?display:\s*none !important/);
  assert.match(css, /\.pdf-native-viewer\[data-state="loading"\]::before\s*\{\s*content:\s*none/);
  assert.match(css, /\.pdf-reader-notices > \.pdf-reader-control\s*\{[\s\S]*?order:\s*-1/);
  assert.match(css, /\.pdf-reader-control\[data-state="error"\] \.pdf-reader-progress/);
  for (const state of ['blocked', 'error', 'cancelled']) {
    assert.match(css, new RegExp(`html\\[data-pdf-enhancement-state="${state}"\\] \\.pdf-reader-progress`));
  }
  assert.match(css, /body\[data-reading-focus\] \.pdf-reader-navigation[\s\S]*?display:\s*none/);
  assert.match(css, /data-pdf-view="original"\]\[data-reading-focus\] \.pdf-original-viewer/);
  assert.match(css, /\.pdf-original-viewer\[data-renderer="native"\] \.pdf-original-embed-hint[\s\S]*?display:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /animation:\s*none\s*!important/);
  assert.match(css, /transition:\s*none\s*!important/);
});

test('presentation controller closes menus first and leaves Escape to active editors', () => {
  assert.match(ui, /if \(!moreMenu\.hidden\)[\s\S]*?setMoreMenu\(false, \{ restoreFocus: true \}\)[\s\S]*?return;/);
  assert.match(ui, /event\.target\.closest\('input, textarea, select, \[contenteditable="true"\], \[role="dialog"\]'\)/);
  assert.ok(ui.indexOf("if (!moreMenu.hidden)") < ui.indexOf("if (!body.hasAttribute('data-reading-focus'))"));
  assert.match(ui, /setFocusMode\(false, \{ restoreFocus: true \}\)/);
  assert.match(ui, /severeTitle \? `\$\{severeTitle\} · 共 \$\{count\} 条阅读状态`/);
  assert.match(ui, /moreMenu\.addEventListener\('click',[\s\S]*?closest\('\[role="menuitem"\]'\)[\s\S]*?setMoreMenu\(false\)/);
});

test('UI script loads after the existing reader controller and before the native module', () => {
  const controller = html.indexOf('<script src="pdf-reader.js"></script>');
  const uiScript = html.indexOf('<script src="pdf-reader-ui.js"></script>');
  const notices = html.indexOf('<script src="pdf-reader-notices.js"></script>');
  const nativeModule = html.indexOf('<script type="module" src="pdf-native-reader.mjs"></script>');
  assert.ok(controller >= 0 && controller < uiScript && uiScript < notices && notices < nativeModule);
});
