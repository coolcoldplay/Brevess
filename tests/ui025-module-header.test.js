const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = read('popup.html');
const source = read('popup.js');

test('UI025 primary modules have no redundant top title/copy but retain dynamic statuses', () => {
  for (const id of ['workspace-navigation', 'workspace-highlights', 'workspace-figures', 'workspace-chat', 'literatureNoteDrawer']) {
    const start = html.indexOf(`<section id="${id}"`);
    assert.ok(start >= 0);
    const end = html.indexOf('\n      </section>', start);
    assert.ok(end > start);
    assert.doesNotMatch(html.slice(start, end), /data-sidebar-focus-heading-copy|class="workspace-view-heading"|class="literature-note-heading"/, id);
  }
  for (const id of ['articleNavigationStatus', 'highlightHeaderTaskStatus', 'figureHeaderTaskStatus', 'articleChatModelStatus', 'literatureNoteStatus']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
});

test('UI025 refresh actions immediately follow save, are module-scoped SVG-only buttons', () => {
  const start = html.indexOf('<button id="saveCurrentArticleWorkspace"');
  const end = html.indexOf('<details id="sidePanelMoreTools"', start);
  const region = html.slice(start, end);
  for (const [id, view] of [['refreshArticleNavigation', 'navigation'], ['refreshFigureInventory', 'figures']]) {
    const button = region.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0];
    assert.ok(button, id);
    assert.match(button, new RegExp(`data-workspace-tools="${view}"`));
    assert.match(button, /title="[^"]+"/);
    assert.match(button, /aria-label="[^"]+"/);
    assert.match(button, /<svg\b[^>]*aria-hidden="true"/);
    assert.equal(button.replace(/<[^>]+>/g, '').trim(), '');
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
});

test('UI025 refresh retains its local workspace route, duplicate guard and terminal busy cleanup', async () => {
  const start = source.indexOf('async function runWorkspaceRefreshButton(');
  const end = source.indexOf('\nasync function ', start + 1);
  let release;
  let calls = 0;
  const attributes = new Map();
  const classes = new Set();
  const button = { disabled: false, getAttribute: name => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name),
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const context = vm.createContext({ requestAnimationFrame: callback => callback(), setTimeout: callback => callback(),
    refreshArticleWorkspace: options => {
      assert.equal(options.announce, true);
      calls += 1;
      return new Promise(resolve => { release = resolve; });
    } });
  vm.runInContext(source.slice(start, end), context);
  const pending = context.runWorkspaceRefreshButton(button);
  assert.equal(button.disabled, true);
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.equal(await context.runWorkspaceRefreshButton(button), null);
  assert.equal(calls, 1);
  release('refreshed');
  assert.equal(await pending, 'refreshed');
  assert.equal(button.disabled, false);
  assert.equal(attributes.has('aria-busy'), false);
  context.refreshArticleWorkspace = async () => { throw new Error('refresh failed'); };
  await assert.rejects(context.runWorkspaceRefreshButton(button), /refresh failed/);
  assert.equal(button.disabled, false);
  assert.equal(attributes.has('aria-busy'), false);
});
