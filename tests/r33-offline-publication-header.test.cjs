'use strict';
// Source-root contract; renderer/cold-open acceptance is separately owned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source.js');
const api = require('../core/faithful-page-snapshot.js');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const fixture = new Function(functionSource(fs.readFileSync(path.join(__dirname, 'r21-export-faithful-snapshot.test.js'), 'utf8'), 'fixture') + '\nreturn fixture;')();
const TITLE = 'Microbiota-shaped neutrophil senescence regulates sexual dimorphism in bladder cancer';
const PUBLICATION = ['Nature Immunology volume 26, pages 722–736 (2025) Cite this article', '14k Accesses', '32 Citations', '25 Altmetric', 'Metrics details'];

function addDomQueries(f) {
  const proto = Object.getPrototypeOf(f.article);
  Object.defineProperty(proto, 'children', { get() { return this.childNodes.filter(node => node.nodeType === 1); } });
  Object.defineProperty(proto, 'isConnected', { get() { return this.ownerDocument.documentElement.contains(this); } });
  proto.removeAttribute = function (name) { this._attrs.delete(name); };
  proto.matches = function (selectors) {
    return selectors.split(',').some(selector => {
      const match = selector.trim().match(/^([a-z][a-z0-9-]*)?((?:\.[a-z0-9_-]+)*)$/i);
      return !!match && (!match[1] || this.localName === match[1].toLowerCase()) &&
        (match[2].match(/\.[a-z0-9_-]+/gi) || []).every(name => (this.getAttribute('class') || '').split(/\s+/).includes(name.slice(1)));
    });
  };
  proto.querySelectorAll = function (selector) {
    const found = [];
    const walk = node => { for (const child of node.children) { if (selector === '*' || child.matches(selector)) found.push(child); walk(child); } };
    walk(this); return found;
  };
  proto.closest = function (selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; };
  return f;
}

function publicationFixture() {
  const f = addDomQueries(fixture());
  f.document.URL = f.document.baseURI = 'https://www.nature.com/articles/s41590-025-02126-6';
  f.document.location = { hostname: 'www.nature.com' };
  f.article.removeAttribute('id'); f.article.removeAttribute('class'); f.article.setAttribute('lang', 'en');
  f.header = f.element('div', { class: 'c-article-header' });
  const header = f.element('header'); f.header.appendChild(header);
  f.title = f.element('h1', { class: 'c-article-title', 'data-article-title': '' }, TITLE); header.appendChild(f.title);
  f.author = f.element('a', { href: '#auth-Qingchen-Zhu-Aff1', 'data-author-popup': 'auth-Qingchen-Zhu-Aff1' }, 'Qingchen Zhu'); header.appendChild(f.author);
  PUBLICATION.forEach((text, index) => header.appendChild(f.element('p', { class: index ? 'c-article-metrics-bar__count' : 'c-article-info-details' }, text)));
  // These observed header controls are removed by the existing core sanitizer.
  const form = f.element('form', { action: 'https://www.nature.com/action' }); form.appendChild(f.element('input', { value: 'not copied' })); header.appendChild(form);
  header.appendChild(f.element('button', { onclick: 'bad()' }, 'Header control'));
  f.body = f.element('div', { class: 'c-article-body' });
  f.body.appendChild(f.element('p', {}, 'Original body paragraph.'));
  for (let n = 1; n <= 7; n++) { const figure = f.element('figure', { id: 'Fig' + n }); figure.appendChild(f.element('img', { src: 'data:image/png;base64,AA==', alt: 'Figure ' + n })); f.body.appendChild(figure); }
  // Real source has three recommendation articles in the existing body.
  for (let n = 1; n <= 3; n++) { const recommendation = f.element('article', { class: 'recommendation' }); recommendation.appendChild(f.element('h1', { class: 'c-article-title' }, 'Recommended article ' + n)); f.body.appendChild(recommendation); }
  f.article.appendChild(f.header); f.article.appendChild(f.body);
  return f;
}

function selection(f, root = f.body, realCapture = false) {
  let selected;
  const h = { document: f.document, Map, Set, Array, String, Number, Date,
    articleWorkspaceLifecycleGeneration: 1, contentDocumentIdentity: 'document-one', currentArticleWorkspace: { id: 'workspace-one' },
    effectiveArticlePageUrl: () => f.document.URL, contentNavigationIdentity: () => f.document.URL,
    currentManualDocument: { record: { annotations: [] } },
    SciLLM: { captureFaithfulPageSnapshot(options) { selected = options.articleRoot; return realCapture ? api.captureFaithfulPageSnapshot(options) : { selectedRoot: selected }; } } };
  vm.createContext(h);
  const start = source.indexOf('function snapshotArticleRootScore('), end = source.indexOf('function appendSnapshotAnnotationAppendix(', start);
  assert.ok(start >= 0 && end > start);
  // Load the actual resolver block, including its new adjacent helper. There is
  // no missing-helper fallback: current call sites execute what production has.
  vm.runInContext(source.slice(start, end), h);
  h.resolveZoteroSnapshotArticleRoot = () => root;
  vm.runInContext(functionSource(source, 'captureOfflineArticleSnapshot'), h);
  const captured = h.captureOfflineArticleSnapshot({ article: { title: TITLE }, collected: { records: [] } });
  return { root: selected, captured, context: h };
}

test('exact Nature header/body source expands only the two faithful call sites and leaves the legacy root call', () => {
  assert.match(functionSource(source, 'captureOfflineArticleSnapshot'), /articleRoot:\s*resolveFaithfulSnapshotArticleRoot\(\)/);
  assert.match(functionSource(source, 'exportEnhancedSnapshotToZotero'), /articleRoot:\s*resolveFaithfulSnapshotArticleRoot\(\)/);
  assert.match(functionSource(source, 'buildEnhancedArticleSnapshotHtml'), /const liveRoot = resolveZoteroSnapshotArticleRoot\(\)/);
});

test('strict observed structure includes public header while keeping all body recommendation articles', () => {
  const f = publicationFixture(), before = f.document.documentElement.outerHTML;
  assert.ok(selection(f).root === f.article, 'faithful source root includes the observed publication header');
  assert.equal(f.document.documentElement.outerHTML, before);
});

test('unassigned direct article text falls back; whitespace and comments add no exported content', () => {
  const f = publicationFixture(); f.article.insertBefore(f.document.createTextNode('Unassigned article text.'), f.body);
  assert.ok(selection(f).root === f.body);
  const clean = publicationFixture(); clean.article.insertBefore(clean.document.createTextNode('\n  '), clean.header);
  const comment = clean.document.createTextNode('COMMENT_MUST_NOT_COPY'); comment.nodeType = 8; clean.article.appendChild(comment);
  assert.ok(selection(clean).root === clean.article, 'whitespace and inert comments retain the strict source layout');
  assert.doesNotMatch(selection(clean, clean.body, true).captured.faithfulCapture.outputDocument.documentElement.outerHTML, /COMMENT_MUST_NOT_COPY/);
});

test('actual faithful capture retains the title, five publication paragraphs, body and seven figures; controls stay inert', async () => {
  const f = publicationFixture(), before = f.document.documentElement.outerHTML;
  const { captured } = selection(f, f.body, true), capture = captured.faithfulCapture;
  const resources = await api.collectFaithfulSnapshotResources(capture, {});
  const result = api.serializeFaithfulPageSnapshot(capture, resources);
  assert.ok(result.html.includes(TITLE)); for (const text of PUBLICATION) assert.ok(result.html.includes(text));
  assert.match(result.html, /Original body paragraph/); assert.match(result.html, /Qingchen Zhu/);
  assert.equal((result.html.match(/<figure /g) || []).length, 7);
  assert.equal((result.html.match(/src="data:image\/png;base64,AA=="/g) || []).length, 7);
  assert.doesNotMatch(result.html, /<form|<input|<button|onclick|data-author-popup|<script|src="https?:/i);
  assert.equal(f.document.documentElement.outerHTML, before);
});

for (const host of ['nature.com', 'sub.nature.com', 'www.nature.com.evil.test', 'cell.com', '']) test('does not expand another or absent exact host ' + JSON.stringify(host), () => {
  const f = publicationFixture(); f.document.location.hostname = host; assert.ok(selection(f).root === f.body);
});

for (const change of ['extra-child', 'second-header', 'wrong-order', 'second-title', 'title-in-body', 'wrong-title-class', 'blank-title', 'nested-header-article', 'indirect-body', 'wrong-header-tag', 'wrong-body-tag', 'wrong-body-class']) test('ambiguous or unsupported structure falls back: ' + change, () => {
  const f = publicationFixture();
  if (change === 'extra-child') f.article.appendChild(f.element('div'));
  if (change === 'second-header') f.article.insertBefore(f.element('div', { class: 'c-article-header' }), f.header);
  if (change === 'wrong-order') f.article.appendChild(f.header);
  if (change === 'second-title') f.header.appendChild(f.element('h1', { class: 'c-article-title' }, 'Another title'));
  if (change === 'title-in-body') f.body.appendChild(f.element('h1', { class: 'c-article-title' }, 'Another title'));
  if (change === 'wrong-title-class') f.title.setAttribute('class', 'other-title');
  if (change === 'blank-title') f.title.textContent = '  ';
  if (change === 'nested-header-article') f.header.appendChild(f.element('article'));
  if (change === 'indirect-body') { const wrapper = f.element('section'); f.article.appendChild(wrapper); wrapper.appendChild(f.body); }
  if (change === 'wrong-header-tag') { f.header.localName = 'header'; f.header.tagName = 'HEADER'; }
  if (change === 'wrong-body-tag') { f.body.localName = 'section'; f.body.tagName = 'SECTION'; }
  if (change === 'wrong-body-class') f.body.setAttribute('class', 'other-body');
  assert.ok(selection(f).root === f.body);
});

for (const attributes of [{ class: 'account' }, { id: 'login-content' }, { class: 'author-popover' }, { class: 'publisher-popup' }, { popover: 'auto' }, { role: 'dialog' }, { role: 'tooltip' }, { role: 'menu' }, { 'data-sci-plugin-ui': '' }, { 'data-sci-translation': '' }, { id: 'sci-reading-panel' }, { id: 'SCI-reading-panel' }]) test('private, popover or plugin header node does not widen root: ' + JSON.stringify(attributes), () => {
  const f = publicationFixture(); f.header.appendChild(f.element('div', attributes, 'PRIVATE_CONTENT'));
  assert.ok(selection(f).root === f.body);
});

test('private article/header/body identities keep the original root and core private-ancestor rejection', () => {
  for (const where of ['article', 'header', 'body']) { const f = publicationFixture(); f[where].setAttribute('class', (f[where].getAttribute('class') || '') + ' account'); assert.ok(selection(f).root === f.body); }
  const f = publicationFixture(); f.wrapper.setAttribute('class', 'user-account');
  assert.throws(() => selection(f, f.body, true), { code: 'EXPORT_SNAPSHOT_PRIVATE_ROOT' });
});

for (const role of [' dialog ', 'dialog tooltip']) test('private ARIA role tokens keep popup text outside the actual captured reading root: ' + JSON.stringify(role), () => {
  const f = publicationFixture(); f.header.appendChild(f.element('div', { role }, 'PRIVATE_POPUP_CONTENT'));
  const result = selection(f, f.body, true);
  assert.doesNotMatch(result.captured.faithfulCapture.outputDocument.documentElement.outerHTML, /PRIVATE_POPUP_CONTENT/);
  assert.ok(result.root === f.body);
});

test('empty, whitespace and ordinary unknown role tokens preserve public header eligibility', () => {
  for (const role of ['', ' \t\n\f\r ', 'group', 'group heading', 'publisher-metadata']) {
    const f = publicationFixture(); f.header.appendChild(f.element('div', { role }, 'Public supplemental metadata'));
    const result = selection(f, f.body, true);
    assert.ok(result.root === f.article); assert.match(result.captured.faithfulCapture.outputDocument.documentElement.outerHTML, /Public supplemental metadata/);
  }
});

test('all ARIA ASCII whitespace separators detect the existing private role tokens', () => {
  for (const role of ['group\tdialog', '\ntooltip\r', 'menu\fgroup']) {
    const f = publicationFixture(); f.header.appendChild(f.element('div', { role }, 'PRIVATE_POPUP_CONTENT'));
    const result = selection(f, f.body, true);
    assert.doesNotMatch(result.captured.faithfulCapture.outputDocument.documentElement.outerHTML, /PRIVATE_POPUP_CONTENT/);
    assert.ok(result.root === f.body);
  }
});

test('null, foreign, disconnected and broad roots preserve existing rejection instead of widening', () => {
  const f = publicationFixture(), foreign = publicationFixture().body;
  assert.ok(selection(f, null).root === null); assert.ok(selection(f, foreign).root === foreign);
  assert.ok(selection(f, f.document.body).root === f.document.body);
  assert.throws(() => selection(f, null, true), { code: 'EXPORT_SNAPSHOT_INVALID_ROOT' });
  assert.throws(() => selection(f, foreign, true), { code: 'EXPORT_SNAPSHOT_INVALID_ROOT' });
  assert.throws(() => selection(f, f.document.body, true), { code: 'EXPORT_SNAPSHOT_INVALID_ROOT' });
  f.article.removeChild(f.body); assert.ok(selection(f).root === f.body);
  assert.throws(() => selection(f, f.body, true), { code: 'EXPORT_SNAPSHOT_INVALID_ROOT' });
  const text = f.document.createTextNode('Not an element'); text.matches = undefined; f.article.appendChild(text);
  assert.ok(selection(f, text).root === text);
});

module.exports = { publicationFixture, selection, addDomQueries };
