const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('article chat uses one Swiss composer shell with input above its toolbar', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const shell = html.match(/<div class="article-chat-input-row">([\s\S]*?)<\/form>/)?.[1] || '';

  assert.match(shell, /id="articleChatQuestion"/);
  assert.match(shell, /class="article-chat-submit-controls"/);
  assert.match(shell, /id="articleChatWebSearch"/);
  assert.match(shell, /id="articleChatProfile"/);
  assert.match(shell, /id="sendArticleChat"/);
  assert.ok(shell.indexOf('articleChatQuestion') < shell.indexOf('article-chat-submit-controls'));
  assert.match(css, /\.article-chat-input-row\s*\{[^}]*border:\s*1px solid/s);
  assert.match(read('ui-swiss.css'), /:is\([^)]*\.article-chat-input-row[^)]*\)\s*\{[^}]*border-radius:\s*0/s);
  assert.match(css, /\.article-chat-input-row:focus-within/);
});

test('composer keeps a real three-line textarea without a competing inner card', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const textarea = html.match(/<textarea[^>]*id="articleChatQuestion"[^>]*>/)?.[0] || '';

  assert.match(textarea, /rows="3"/);
  assert.match(css, /\.article-chat-composer textarea\s*\{[^}]*min-height:\s*78px/s);
  assert.match(css, /\.article-chat-composer textarea\s*\{[^}]*border:\s*0/s);
  assert.match(css, /\.article-chat-composer textarea:focus\s*\{[^}]*outline:\s*none/s);
});

test('web, model, and send controls form one compact non-overlapping toolbar', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const toolbarStart = html.indexOf('<div class="article-chat-submit-controls">');
  const toolbarEnd = html.indexOf('id="articleChatSearchOption"', toolbarStart);
  const toolbar = html.slice(toolbarStart, toolbarEnd);

  assert.ok(toolbar.indexOf('articleChatWebSearch') < toolbar.indexOf('articleChatProfile'));
  assert.ok(toolbar.indexOf('articleChatProfile') < toolbar.indexOf('sendArticleChat'));
  assert.match(html, /class="article-chat-model-picker"/);
  assert.match(css, /\.article-chat-submit-controls\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.article-chat-model-picker\s*\{[^}]*min-width:\s*0[^}]*max-width:/s);
  assert.match(css, /\.article-chat-submit-controls select\s*\{[^}]*text-overflow:\s*ellipsis/s);
});

test('send remains the clear square icon action in send and stop states', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const send = html.match(/<button[^>]*id="sendArticleChat"[\s\S]*?<\/button>/)?.[0] || '';

  assert.match(send, /ph-paper-plane-tilt/);
  assert.match(send, /<span id="sendArticleChatLabel">发送<\/span>/);
  assert.match(css, /#sendArticleChat\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s);
  assert.match(read('ui-swiss.css'), /#sendArticleChat\s*\{[^}]*border-radius:\s*0/s);
  assert.match(css, /#sendArticleChat span\s*\{[^}]*clip:/s);
  assert.match(css, /#sendArticleChat\[data-mode="cancel"\]/);
});

test('secondary web guidance is descriptive and search highlighting belongs to excerpts', () => {
  const html = read('popup.html');
  const excerpts = html.match(/<section id="workspace-highlights"[\s\S]*?<\/section>/)?.[0] || '';
  const chat = html.match(/<section id="workspace-chat"[\s\S]*?<\/section>/)?.[0] || '';
  const textarea = html.match(/<textarea[^>]*id="articleChatQuestion"[^>]*>/)?.[0] || '';
  const web = html.match(/<button[^>]*id="articleChatWebSearch"[^>]*>/)?.[0] || '';

  assert.match(html, /id="articleChatSearchOption"[^>]*class="article-chat-search-option"/);
  assert.match(read('popup.css'), /\.article-chat-search-option\s*\{[^}]*clip:\s*rect/s);
  assert.match(web, /aria-describedby="articleChatSearchOption"/);
  assert.match(textarea, /aria-describedby="articleChatSearchOption"/);
  assert.doesNotMatch(chat, /articleChatHighlightCategory|highlightArticleChatMatches|智能检索高亮/);
  assert.match(excerpts, /id="articleChatHighlightCategory"/);
  assert.match(excerpts, /id="articleSemanticHighlightQuery"/);
  assert.match(excerpts, /id="articleSemanticHighlightProfile"/);
  assert.match(excerpts, /<summary>智能检索高亮<\/summary>/);
});

test('composer preserves every real control and uses a bundled icon for the stop state', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const icons = read('vendor/phosphor/icons.css');
  for (const id of [
    'articleChatQuestion', 'articleChatWebSearch', 'articleChatProfile',
    'sendArticleChat', 'articleChatHighlightCategory', 'articleChatHighlightColor',
    'highlightArticleChatMatches'
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  assert.match(popup, /articleChatWebSearch[^]*addEventListener\('click'/);
  assert.match(popup, /articleChatProfile[^]*addEventListener\('change'/);
  assert.match(popup, /articleChatForm[^]*addEventListener\('submit'/);
  assert.match(html, /id="sendArticleChat"[^>]*aria-labelledby="sendArticleChatLabel"/);
  assert.match(popup, /\?\s*'ph ph-x'\s*:\s*'ph ph-paper-plane-tilt'/);
  assert.match(icons, /\.ph\.ph-x::before/);
});

test('320px reflow removes the old global floor and stacks only the secondary highlight action', () => {
  const css = read('popup.css');
  assert.match(css, /@media\s*\(max-width:\s*359px\)[^{]*\{[^]*?body\s*\{[^}]*min-width:\s*320px/s);
  assert.match(css, /@media\s*\(max-width:\s*420px\)[^{]*\{[^]*?\.article-chat-highlight-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+38px/s);
  assert.match(css, /\.article-chat-highlight-row \.btn\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
});

test('dynamic model, category, send, and stop labels use the interface translator', () => {
  const popup = read('popup.js');
  const i18n = read('core/i18n.js');
  assert.match(popup, /option\.textContent\s*=\s*t\('尚未配置可用模型'\)/);
  assert.match(popup, /categoryId\s*===\s*'semantic_match'[^]*t\('智能检索匹配'\)/);
  assert.match(popup, /label\.textContent\s*=\s*t\(loading\s*\?\s*'取消回答'\s*:\s*'发送'\)/);
  assert.match(popup, /send\.setAttribute\('aria-label',\s*t\(loading\s*\?\s*'取消回答'\s*:\s*'发送'\)\)/);
  assert.match(i18n, /'尚未配置可用模型':\s*'No available model configured'/);
  assert.match(i18n, /'智能检索匹配':\s*'Semantic match'/);
});
