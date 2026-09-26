const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_OFFLINE_SNAPSHOT_BYTES,
  isAllowedOfflineSnapshotAttribute,
  selectBoundedOfflineSnapshotHtml
} = require('../core/privacy-sanitizer.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('explicit local save persists a privacy-clean offline article snapshot only when enabled', () => {
  const content = read('content.js');
  assert.match(content, /OFFLINE_ARTICLE_SNAPSHOT_PATH\s*=\s*'article\/offline-snapshot\.html'/);
  assert.match(content, /async function persistOfflineArticleSnapshot\(/);
  assert.match(content, /saveArticleWebSnapshot\s*===\s*false/);
  assert.match(content, /buildEnhancedArticleSnapshotHtml/);
  assert.match(content, /persistWorkspaceAssetCheckpoint\(\s*OFFLINE_ARTICLE_SNAPSHOT_PATH/);
  const saveStart = content.indexOf('async function saveCurrentArticleWorkspaceNow(');
  const saveEnd = content.indexOf('\nfunction ', saveStart + 1);
  assert.match(content.slice(saveStart, saveEnd), /persistOfflineArticleSnapshot/);
});

test('offline snapshot is built from the resolved article root in an independent document', () => {
  const content = read('content.js');
  const start = content.indexOf('function buildEnhancedArticleSnapshotHtml(');
  const end = content.indexOf('\nasync function collectZoteroSnapshotFigureResources(', start);
  const source = content.slice(start, end);
  assert.match(source, /resolveZoteroSnapshotArticleRoot\(\)/);
  assert.match(source, /document\.implementation\.createHTMLDocument\(/);
  assert.match(source, /importNode\(liveRoot,\s*true\)/);
  assert.doesNotMatch(source, /const\s+liveRoot\s*=\s*document\.documentElement/);
  assert.doesNotMatch(source, /liveRoot\.cloneNode\(true\)/);
  assert.match(source, /default-src 'none'/);
});

test('offline snapshot removes active, account, form, embedded, stylesheet, and remote-media content', () => {
  const content = read('content.js');
  const start = content.indexOf('function cleanZoteroSnapshotArticleRoot(');
  const end = content.indexOf('\nfunction appendZoteroSnapshotFigureGallery(', start);
  const source = content.slice(start, end);
  for (const unsafeElement of [
    'script', 'form', 'input', 'iframe', 'object', 'embed', 'link', 'video', 'audio'
  ]) {
    assert.match(source, new RegExp(`['\"]${unsafeElement}['\"]|${unsafeElement},`), unsafeElement);
  }
  assert.match(source, /isAllowedOfflineSnapshotAttribute/);
  assert.match(source, /data:image/);
  assert.match(source, /removeAttribute\('src'\)/);
  assert.match(source, /login|account|paywall|subscription/i);
});

test('offline snapshot attribute policy is allow-list based and excludes authentication state', () => {
  assert.equal(isAllowedOfflineSnapshotAttribute('p', 'class', 'methods'), true);
  assert.equal(isAllowedOfflineSnapshotAttribute('h2', 'aria-label', 'Methods'), true);
  assert.equal(isAllowedOfflineSnapshotAttribute('img', 'src', 'data:image/png;base64,AA=='), true);
  assert.equal(isAllowedOfflineSnapshotAttribute('a', 'href', 'https://doi.org/10.1/example'), true);
  assert.equal(isAllowedOfflineSnapshotAttribute('a', 'href', '#methods'), true);
  for (const [tag, name, value] of [
    ['div', 'style', 'background:url(https://tracker.invalid/a)'],
    ['div', 'data-session-token', 'secret'],
    ['div', 'aria-session-token', 'secret'],
    ['input', 'value', 'secret'],
    ['img', 'src', 'https://publisher.invalid/authenticated.jpg'],
    ['img', 'srcset', 'https://publisher.invalid/a.jpg 2x'],
    ['a', 'href', 'javascript:alert(1)'],
    ['div', 'onclick', 'alert(1)'],
    ['div', 'nonce', 'publisher-nonce']
  ]) {
    assert.equal(isAllowedOfflineSnapshotAttribute(tag, name, value), false, `${tag}[${name}]`);
  }
});

test('offline snapshot retries without images then fails closed if still over 64 MiB', () => {
  assert.equal(MAX_OFFLINE_SNAPSHOT_BYTES, 64 * 1024 * 1024);
  let fallbackCalls = 0;
  const compact = selectBoundedOfflineSnapshotHtml('123456789', () => {
    fallbackCalls += 1;
    return '1234';
  }, 8);
  assert.deepEqual(compact, {
    html: '1234',
    byteSize: 4,
    embeddedImagesRetained: false
  });
  assert.equal(fallbackCalls, 1);

  assert.throws(
    () => selectBoundedOfflineSnapshotHtml('123456789', () => '123456789', 8),
    error => error?.code === 'OFFLINE_SNAPSHOT_TOO_LARGE_AFTER_IMAGE_FALLBACK' &&
      /移除图片后仍超过/.test(error.message) && error.byteSize === 9 && error.maxBytes === 8
  );
});

test('settings history offers offline reading only for workspaces with a saved snapshot', () => {
  const router = read('core/background-router.js');
  const options = read('options.js');
  assert.match(router, /hasOfflineSnapshot/);
  assert.match(router, /article\/offline-snapshot\.html/);
  assert.match(options, /\['offline', '离线阅读'\]/);
  assert.match(options, /offline-reader\.html\?workspaceId=/);
});

test('offline reading is handled by the workspace action instead of the category importer', () => {
  const options = read('options.js');
  const action = options.slice(
    options.indexOf('async function handleArticleWorkspaceAction('),
    options.indexOf('// Article workspace overview: end.')
  );
  const importer = options.slice(
    options.indexOf('async function importCategoryModule('),
    options.indexOf('function setCategoryPending(')
  );

  assert.match(action, /action === 'offline'/);
  assert.match(action, /chrome\.runtime\.getURL\([\s\S]*offline-reader\.html\?workspaceId=/);
  assert.match(action, /await chrome\.tabs\.create\(\{ url \}\)/);
  assert.match(action, /无法打开离线阅读|已打开离线阅读/);
  assert.doesNotMatch(importer, /action === 'offline'|offline-reader\.html|workspaceId/);
});

test('offline reader loads the stored HTML into a scriptless sandboxed frame', async () => {
  const html = read('offline-reader.html');
  const script = read('offline-reader.js');
  assert.match(html, /id="offlineArticleFrame"/);
  assert.match(html, /sandbox="allow-popups allow-top-navigation-by-user-activation"/);
  assert.match(script, /ARTICLE_WORKSPACE_GET_ASSET/);
  assert.match(script, /article\/offline-snapshot\.html/);
  assert.match(script, /frame\.srcdoc\s*=/);
  assert.doesNotMatch(script, /innerHTML\s*=/);
  const { releaseInventory } = await import('../scripts/release-inventory.mjs');
  assert.ok(releaseInventory(path.join(__dirname, '..'), 'browser')
    .some(file => file.path === 'offline-reader.html'));
  assert.match(read('scripts/build-unpacked-extension.ps1'), /Copy-BrevessReleaseFiles/);
});
