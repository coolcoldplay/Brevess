const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const css = read('ui-swiss.css');
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('all four real application surfaces load the Swiss skin after existing styles', () => {
  for (const [file, surface] of [['options.html','settings'], ['popup.html','sidebar'],
    ['action-popup.html','action'], ['pdf-reader.html','pdf']]) {
    const html = read(file);
    assert.equal((html.match(/href="ui-swiss.css"/g) || []).length, 1);
    assert.ok(html.indexOf('href="ui-swiss.css"') > html.lastIndexOf('href="' + file.replace('.html','.css') + '"'));
    assert.match(html, new RegExp(`<body[^>]*data-ui-surface="${surface}"`));
  }
});

test('numbered settings retain all nine real destinations and the mobile selector', () => {
  const html = read('options.html');
  const nav = html.slice(html.indexOf('<aside class="settings-sidebar"'), html.indexOf('</aside>'));
  assert.deepEqual([...nav.matchAll(/data-settings-nav="([^"]+)"/g)].map(m=>m[1]),
    ['overview','storage','models','modes','categories','reading','shortcuts','data','about']);
  assert.deepEqual([...nav.matchAll(/class="settings-nav-number" aria-hidden="true">(\d+)/g)].map(m=>m[1]),
    ['01','02','03','04','05','06','07','08','09']);
  assert.match(html, /id="settingsMobilePage"/);
});

test('bottom navigation integrates highlights and promotes notes into the fifth module', () => {
  const html = read('popup.html');
  const nav = html.slice(html.indexOf('<nav class="workspace-bottom-nav"'), html.indexOf('</nav>',html.indexOf('<nav class="workspace-bottom-nav"')));
  assert.deepEqual([...nav.matchAll(/data-workspace-target="([^"]+)"/g)].map(m=>m[1]),
    ['navigation','highlights','figures','chat','notes']);
  assert.match(html, /id="openLiteratureNote"/);
  assert.match(css, /\.workspace-nav-button\[aria-selected="true"\][^{]*\{[^}]*background:\s*var\(--swiss-ink\);[^}]*color:\s*#fff/);
});

test('Swiss heading hierarchy targets the actual primary h1, not only former h2', () => {
  assert.match(css, /\.settings-panel-heading h1/);
});

test('settings use an open canvas instead of a nested outer panel', () => {
  assert.match(css, /\[data-ui-surface="settings"\] \.settings-panel\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;/);
});

test('navigation toolbar and chat composer receive explicit quiet chrome treatment', () => {
  assert.match(css, /\[data-ui-surface="sidebar"\] \.navigation-outline-controls \.side-panel-tool-button\s*\{[^}]*background:\s*#fff;/);
  assert.match(css, /\[data-ui-surface="sidebar"\] \.article-chat-composer\s*\{[^}]*background:\s*#fff;/);
});

test('visible keyboard focus stays within the bottom rail instead of being clipped', () => {
  assert.match(css, /\.workspace-nav-button:focus-visible\s*\{[^}]*outline-offset:\s*-4px;/);
});

test('skin does not target PDF text/canvas or scientific highlight rendering', () => {
  assert.doesNotMatch(withoutComments, /(?:\.pdfViewer|\.textLayer|\.annotationLayer|\.highlightLayer|\.sci-highlight|(?:^|[\s,])canvas(?:[\s,{])|(?:^|[\s,])mark(?:[\s,{]))/m);
  assert.doesNotMatch(withoutComments, /--category-color\s*:/);
  assert.doesNotMatch(withoutComments, /(?:^|[;{\s])(?:filter|mix-blend-mode)\s*:/m);
});

test('toolbar intrinsic width remains the existing 360px contract', () => {
  assert.match(read('action-popup.css'), /html,\s*body\s*\{[^}]*width:\s*360px;[^}]*min-width:\s*360px;[^}]*max-width:\s*360px;/);
});
