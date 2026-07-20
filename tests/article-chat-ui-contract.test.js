const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('side panel exposes a fifth full-text chat workspace with per-turn model selection', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  assert.match(html, /data-workspace-view="chat"/);
  assert.match(html, /data-workspace-target="chat"/);
  assert.match(html, /id="articleChatProfile"/);
  assert.match(html, /id="articleChatQuestion"/);
  assert.match(html, /id="sendArticleChat"/);
  assert.match(popup, /function getArticleChatProfiles/);
  assert.match(popup, /action: 'askArticleWithLLM', question, profileId/);
  assert.match(popup, /articleChatProfile.*addEventListener\('change'/s);
});

test('content sends canonical workspace paragraphs and persists only public chat state', () => {
  const content = read('content.js');
  const chat = content.slice(
    content.indexOf('function publicArticleChatMessage'),
    content.indexOf('function clearArticleChat')
  );
  assert.match(chat, /getCanonicalArticleSnapshot\(\)/);
  assert.match(chat, /snapshot\.paragraphs/);
  assert.doesNotMatch(chat, /forceRefresh:\s*true/);
  assert.match(chat, /sourceKey: String\(item\?\.sourceKey/);
  assert.match(chat, /type: 'LLM_ASK_ARTICLE'/);
  assert.match(chat, /profileId: normalizedProfileId/);
  assert.match(chat, /history/);
  assert.doesNotMatch(chat, /apiKey|customHeaders|authorization/i);
  assert.match(content, /chat:\s*\{[\s\S]*messages:/);
});

test('full-text chat reports when a very long paper used a relevance-bounded context', () => {
  const core = read('core/article-chat.js');
  const popup = read('popup.js');
  assert.match(core, /ARTICLE_CHAT_MAX_CONTEXT_CHARS\s*=\s*220000/);
  assert.match(core, /truncated:\s*selectedIndexes\.size < paragraphs\.length/);
  assert.match(popup, /超长文章已优先保留相关章节/);
  assert.match(popup, /已发送全文/);
});

test('full-text chat renders a scrollable multi-turn Markdown stream with paragraph jumps', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  assert.match(popup, /function renderArticleChatMarkdown/);
  assert.match(popup, /appendArticleChatInlineMarkdown/);
  assert.match(popup, /createWorkspaceElement\('strong'/);
  assert.match(popup, /createWorkspaceElement\(ordered \? 'ol' : 'ul'\)/);
  assert.doesNotMatch(popup, /articleChatMessages[\s\S]{0,500}innerHTML/);
  assert.doesNotMatch(popup, /role === 'assistant'[\s\S]{0,220}:\s*['"](?:你|我)['"]/);
  assert.match(popup, /kind:\s*'paragraph'/);
  assert.match(popup, /paragraphId/);
  assert.match(popup, /sourceKey/);
  assert.match(popup, /article-chat-inline-citation/);
  assert.match(popup, /focusArticleChatCitation/);
  assert.match(popup, /inlineCitationCount/);
  assert.match(css, /\.article-chat-inline-citation/);
  assert.match(popup, /!event\.shiftKey && !event\.isComposing/);
  assert.match(css, /\.workspace-chat-view\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.article-chat-messages\s*\{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.article-chat-composer\s*\{[^}]*position:\s*relative/);
  assert.doesNotMatch(css, /\.article-chat-composer\s*\{[^}]*position:\s*sticky/);
});

test('side panel refreshes its shared paragraph snapshot after dynamic article changes', () => {
  const popup = read('popup.js');
  assert.match(popup, /message\?\.type === 'ARTICLE_STRUCTURE_CHANGED'/);
  assert.match(popup, /sender\?\.tab\?\.id/);
  assert.match(popup, /void refreshArticleWorkspace\(\)/);
});
