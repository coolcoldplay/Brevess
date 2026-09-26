const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const readerHtml = read('pdf-reader.html');
const readerCss = read('pdf-reader.css');
const readerNotices = read('pdf-reader-notices.js');
const popupHtml = read('popup.html');
const popupCss = read('popup.css');
const popup = read('popup.js');
const verifier = read('scripts/verify-pdf-reader-sidebar-notices.mjs');

function scriptPosition(file) {
  return readerHtml.indexOf(`<script src="${file}"></script>`);
}

test('reader status producers stay available but never occupy the PDF layout', () => {
  assert.match(readerHtml,
    /id="pdfReaderNoticeStack"[\s\S]{0,180}\shidden(?:\s|>)/u,
    'the legacy producer stack must start hidden before presentation scripts run');
  assert.match(readerCss,
    /\.pdf-reader-notice-stack\s*\{[\s\S]*?display:\s*none\s*!important/u,
    'the hidden producer stack must not acquire layout height in any reader state');

  const stackStart = readerHtml.indexOf('id="pdfReaderNoticeStack"');
  const stackEnd = readerHtml.indexOf('</section>', stackStart);
  const sourceEntry = readerHtml.indexOf('id="pdfLocalFileFallback"');
  assert.ok(stackStart >= 0 && stackEnd > stackStart && sourceEntry > stackEnd,
    'the no-readable-source form must remain an independent main-area surface');
  assert.match(readerCss,
    /body\[data-pdf-surface-readable\]\s*>\s*\.pdf-reader-source-entry[\s\S]*?display:\s*none/u);

  const menuStart = readerHtml.indexOf('id="pdfReaderMoreMenu"');
  const menuEnd = readerHtml.indexOf('</div>', menuStart);
  const menuMarkup = readerHtml.slice(menuStart, menuEnd);
  for (const id of ['pdfReaderRetry', 'pdfReaderOpenSettings']) {
    assert.match(menuMarkup, new RegExp(`id=["']${id}["'][\\s\\S]*?role=["']menuitem["']`),
      `#${id} must be available from the reader More menu`);
  }
});

test('reader notice bridge loads after its producers and exposes a bounded source-scoped snapshot', () => {
  const controller = scriptPosition('pdf-reader.js');
  const presentation = scriptPosition('pdf-reader-ui.js');
  const bridge = scriptPosition('pdf-reader-notices.js');
  const native = readerHtml.indexOf('<script type="module" src="pdf-native-reader.mjs"></script>');
  assert.ok(controller >= 0 && controller < presentation && presentation < bridge && bridge < native,
    'reader notice bridge must observe the established controller before native loading starts');

  for (const field of ['readerUrl', 'readerInstanceId', 'sourceEpoch', 'sourceUrl',
    'documentHash', 'documentGeneration', 'revision', 'notices', 'actions']) {
    assert.match(readerNotices, new RegExp(`\\b${field}\\b`), `snapshot omits ${field}`);
  }
  assert.match(readerNotices, /globalThis\.BrevessPdfReaderNotices\s*=\s*Object\.freeze/u);
  assert.match(readerNotices, /snapshot\(\)\s*\{[\s\S]*?currentSnapshot\(\)/u);
  assert.match(readerNotices, /const\s+notices\s*=\s*new Map\(\)/u,
    'channels must replace their latest entry rather than append unbounded progress');
  assert.match(readerNotices,
    /\['reader',[\s\S]*?\['quota',[\s\S]*?\['figure',[\s\S]*?\['save',[\s\S]*?\['remote-source'/u);
  assert.match(readerNotices, /notices\.set\(id,/u);
  assert.match(readerNotices,
    /brevess:pdf-source-changing[\s\S]*?sourceEpoch\s*\+=\s*1[\s\S]*?notices\.clear\(\)/u,
    'a source transition must advance its epoch and clear the prior document snapshot');
});

test('reader emits only a lightweight signal and requires exact scope for allowlisted actions', () => {
  const signal = readerNotices.match(
    /sendMessage\?\.\(\{\s*type:\s*'PDF_READER_NOTICES_CHANGED'[\s\S]*?\}\)/u)?.[0] || '';
  assert.ok(signal, 'missing PDF_READER_NOTICES_CHANGED signal');
  for (const field of ['readerInstanceId', 'sourceEpoch', 'revision']) {
    assert.match(signal, new RegExp(`\\b${field}\\b`), `signal omits ${field}`);
  }
  assert.doesNotMatch(signal, /\bmessage\s*:/u,
    'signal must make the side panel pull trusted text from the current reader');

  assert.match(readerNotices,
    /\['getPdfReaderNotices',\s*'runPdfReaderNoticeAction'\]\.includes\(request\?\.action\)/u);
  assert.match(readerNotices, /sender\?\.id\s*!==\s*chrome\.runtime\.id/u);
  assert.match(readerNotices, /chrome\.runtime\.getURL\('popup\.html'\)/u);
  assert.match(readerNotices,
    /const\s+actionIds\s*=\s*\['pdfReaderRetry',\s*'pdfReaderOpenSettings'\]/u);
  for (const field of ['readerUrl', 'readerInstanceId', 'sourceEpoch', 'sourceUrl',
    'documentHash', 'documentGeneration', 'revision']) {
    assert.match(readerNotices,
      new RegExp(`['"]${field}['"][\\s\\S]{0,250}every\\(key\\s*=>\\s*expected\\[key\\]\\s*===\\s*snapshot\\[key\\]\\)`),
      `runPdfReaderNoticeAction must reject a stale ${field}`);
  }
  assert.match(readerNotices, /button\.hidden\s*\|\|\s*button\.disabled/u);
});

test('side panel accepts only the activated PDF tab and guards both sides of asynchronous pulls', () => {
  assert.match(popup, /function\s+isCurrentPdfReaderNoticeSender\(sender\)/u);
  assert.match(popup,
    /activePanelTabContext\.pdfMode[\s\S]*?activePanelTabContext\.activated[\s\S]*?sender\?\.id\s*===\s*chrome\.runtime\.id[\s\S]*?sender\?\.tab\?\.id[\s\S]*?sender\?\.url/u);
  assert.match(popup, /function\s+refreshPdfReaderNotices\(\)/u);
  assert.match(popup,
    /const\s+context\s*=\s*capturePanelContext\(\)[\s\S]*?\+\+pdfReaderNoticeRequestSequence[\s\S]*?getPdfReaderNotices[\s\S]*?requestSequence\s*!==\s*pdfReaderNoticeRequestSequence[\s\S]*?!isCurrentPanelContext\(context\)/u,
    'the first pull await must be fenced by request sequence and panel context');
  assert.match(popup,
    /await\s+loadSidePanelNotificationHistory\([\s\S]*?requestSequence\s*===\s*pdfReaderNoticeRequestSequence[\s\S]*?isCurrentPanelContext\(context\)[\s\S]*?requestSequence\s*!==\s*pdfReaderNoticeRequestSequence[\s\S]*?!isCurrentPanelContext\(context\)/u,
    'session-history await must be fenced before applying a snapshot');
  assert.match(popup,
    /normalizeTabDocumentUrl\(snapshot\.readerUrl\)\s*!==\s*context\.url/u);
  assert.match(popup,
    /message\?\.type\s*===\s*'PDF_READER_NOTICES_CHANGED'[\s\S]*?isCurrentPdfReaderNoticeSender\(sender\)[\s\S]*?refreshPdfReaderNotices\(\)/u);
});

test('PDF notice history and actions are isolated by reader source and current snapshot', () => {
  assert.match(popup,
    /snapshot\.sourceUrl[\s\S]*?snapshot\.documentHash[\s\S]*?snapshot\.readerInstanceId[\s\S]*?snapshot\.sourceEpoch/u,
    'history must use source/hash, falling back to reader instance and epoch before hashing');
  assert.match(popup, /historyKey\s*=\s*`\$\{activePanelTabContext\.key\}\|pdf:\$\{sourceKey\}`/u);
  assert.match(popup,
    /scope:\s*notificationPanelKey\(\)[\s\S]*?items:\s*sidePanelNotificationHistory\.map/u,
    'session records must carry the unhashed scope so 32-bit storage-key collisions fail closed');
  assert.match(popup, /record\?\.scope\s*===\s*panelKey/u);
  assert.match(popup,
    /const\s+mutationRevision\s*=\s*sidePanelNotificationMutationRevision[\s\S]*?await\s+chrome\.storage\.session\.get[\s\S]*?mutationRevision\s*!==\s*sidePanelNotificationMutationRevision/u,
    'a delayed storage read must detect notifications recorded while awaiting I/O');
  assert.match(popup,
    /\[\.\.\.sidePanelNotificationHistory,\s*\.\.\.loaded\][\s\S]*?sort\([\s\S]*?slice\(0,\s*SIDE_PANEL_NOTIFICATION_HISTORY_LIMIT\)/u);
  assert.match(popup, /if\s*\(newDocument\)\s*\{[\s\S]*?sidePanelNotificationHistory\s*=\s*\[\]/u);
  assert.match(popupHtml, /id="pdfReaderNoticeActions"[^>]*\shidden/u);
  assert.match(popupCss, /\.side-panel-pdf-notice-actions/u);
  assert.match(popup,
    /\['pdfReaderRetry',\s*'pdfReaderOpenSettings'\]\.includes\(action\.id\)/u);
  assert.match(popup,
    /pdfReaderNoticeState\?\.snapshot\s*!==\s*snapshot[\s\S]*?runPdfReaderNoticeAction[\s\S]*?scope:\s*snapshot/u);
});

test('browser verifier covers three layouts and real extension message boundaries', () => {
  for (const viewport of ['1440, height: 1000', '1024, height: 768', '720, height: 900']) {
    assert.match(verifier, new RegExp(viewport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(verifier, /launchPersistentContext/u);
  assert.match(verifier, /--load-extension=/u);
  assert.match(verifier, /PDF_READER_NOTICES_CHANGED/u);
  assert.match(verifier, /getPdfReaderNotices/u);
  assert.match(verifier, /runPdfReaderNoticeAction/u);
  assert.match(verifier, /stale(?:Tab|Document)|old(?:Tab|Document)/u,
    'verifier must prove stale tab/document rejection rather than only render screenshots');
  assert.match(verifier, /sidePanelNotificationCenter/u);
});
