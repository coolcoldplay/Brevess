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
    content.indexOf('function applyArticleChatProgress'),
    content.indexOf('async function analyzeCrossFigureLogicWithLLM')
  );
  assert.match(chat, /getCanonicalArticleSnapshot\(\)/);
  assert.match(chat, /snapshot\.paragraphs/);
  assert.doesNotMatch(chat, /forceRefresh:\s*true/);
  assert.match(chat, /sourceKey: String\(item\?\.sourceKey/);
  assert.match(chat, /type: 'LLM_ASK_ARTICLE'/);
  assert.match(chat, /profileId: turn\.selectedProfileId/);
  assert.match(chat, /history/);
  assert.doesNotMatch(chat, /apiKey|customHeaders|authorization/i);
  assert.match(content, /chat:\s*getPublicArticleChatState\(\)/);
});

test('full-text chat reports when a very long paper used a relevance-bounded context', () => {
  const core = read('core/article-chat.js');
  const popup = read('popup.js');
  assert.match(core, /ARTICLE_CHAT_MAX_CONTEXT_CHARS\s*=\s*220000/);
  assert.match(core, /truncated:\s*selectedIndexes\.size < paragraphs\.length/);
  assert.match(popup, /已按问题覆盖相关章节/);
  assert.match(popup, /已发送完整正文/);
});

test('full-text chat renders a scrollable multi-turn Markdown stream with paragraph jumps', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const css = read('popup.css');
  assert.match(html, /core\/article-chat-citations\.js/);
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

test('article chat citations are verified, inline, and expose visible jump failures', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const citationStart = popup.indexOf('function resolveArticleChatEvidenceTarget');
  const citationEnd = popup.indexOf('function appendArticleChatInlineMarkdown', citationStart);
  const citationWorkflow = popup.slice(citationStart, citationEnd);
  assert.match(citationWorkflow, /SciLLM\.verifyArticleChatEvidence/);
  assert.doesNotMatch(citationWorkflow, /paragraphs\.find[\s\S]*candidateTitle === sectionTitle/);
  assert.match(citationWorkflow, /documentRevision/);
  assert.match(citationWorkflow, /citationResult/);
  assert.match(citationWorkflow, /applyArticleChatCitationState/);
  assert.match(popup, /appendChild\(createArticleChatInlineCitation[\s\S]*citationIndexes\?\.add/);
  assert.match(popup, /findIndex\(item => String\(item\?\.marker/);
  assert.doesNotMatch(popup, /missingEvidence[\s\S]*createArticleChatInlineCitation/);
  assert.match(css, /\.article-chat-inline-citation\.is-ambiguous/);
  assert.match(css, /\.article-chat-inline-citation\.is-missing/);
  assert.match(css, /\.article-chat-inline-citation\.is-stale/);
});

test('side panel refreshes its shared paragraph snapshot after dynamic article changes', () => {
  const popup = read('popup.js');
  assert.match(popup, /message\?\.type === 'ARTICLE_STRUCTURE_CHANGED'/);
  assert.match(popup, /sender\?\.tab\?\.id/);
  assert.match(popup, /void refreshArticleWorkspace\(\)/);
});

test('article chat keeps unlimited turn and block state with immutable queued profiles', () => {
  const content = read('content.js');
  const start = content.indexOf('function createArticleChatTurn');
  const end = content.indexOf('async function analyzeCrossFigureLogicWithLLM', start);
  const workflow = content.slice(start, end);

  assert.ok(start >= 0, 'expected turn-based article chat state');
  assert.match(workflow, /turnId/);
  assert.match(workflow, /answerBlocks/);
  assert.match(workflow, /blockId/);
  assert.match(workflow, /status:\s*'queued'/);
  assert.match(workflow, /selectedProfileId/);
  assert.match(workflow, /turn\.plan = publicArticleChatPlan\(response\.data\.plan\)/);
  assert.match(workflow, /function pumpArticleChatQueue/);
  assert.doesNotMatch(workflow, /\.slice\(-20\)|\.slice\(-40\)/);
});

test('workspace autosave checkpoints complete chat blocks and keeps interrupted tasks inert', () => {
  const content = read('content.js');
  assert.match(content, /function ensureCurrentArticleWorkspace/);
  assert.match(content, /type:\s*'ARTICLE_WORKSPACE_ENSURE'/);
  assert.match(content, /function persistWorkspaceAssetCheckpoint/);
  assert.match(content, /chat\/turns\//);
  assert.match(content, /phase === 'chat_answer_block'[\s\S]{0,900}persistWorkspaceTurnCheckpoint/);
  assert.match(content, /status:\s*turn\.status === 'generating'\s*\?\s*'interrupted'/);
  const restoreStart = content.indexOf('async function applyArticleWorkspaceAssets');
  assert.ok(restoreStart >= 0);
  assert.doesNotMatch(content.slice(restoreStart, restoreStart + 6000), /pumpArticleChatQueue\(/);
});

test('article chat supports delete, answer removal, queued removal, regeneration, and clear', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  for (const action of [
    'deleteArticleChatTurn',
    'deleteArticleChatAnswer',
    'deleteQueuedArticleChatTurn',
    'regenerateArticleChatTurn',
    'clearArticleChat'
  ]) {
    assert.match(content, new RegExp(`request\\.action === '${action}'`));
    assert.match(popup, new RegExp(`action:\\s*'${action}'`));
  }
  assert.match(content, /scheduleCurrentArticleArchiveSave/);
  assert.match(content, /memoryNeedsRebuild:\s*true/);
});

test('side panel incrementally renders keyed turns and complete blocks', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const css = read('popup.css');
  const start = popup.indexOf('function renderArticleChatTurn');
  const end = popup.indexOf('async function submitArticleChat', start);
  const renderer = popup.slice(start, end);

  assert.match(html, /id="articleChatReturnLatest"/);
  assert.match(html, /id="articleChatLoadEarlier"/);
  assert.match(renderer, /dataset\.turnId/);
  assert.match(renderer, /dataset\.blockId/);
  assert.match(renderer, /querySelector\([^\n]*data-turn-id/);
  assert.match(renderer, /appendChild/);
  assert.doesNotMatch(renderer, /container\.replaceChildren\(\)/);
  assert.match(popup, /function isArticleChatNearBottom/);
  assert.match(popup, /articleChatFollowLatest/);
  assert.match(popup, /ARTICLE_CHAT_STATE_CHANGED/);
  assert.match(popup, /articleChatHistoryPageSize/);
  assert.match(css, /\.article-chat-return-latest/);
  assert.match(css, /\.article-chat-turn-actions/);
  assert.doesNotMatch(renderer, /['"]我['"]/);
});
