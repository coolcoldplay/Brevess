const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ArticleChatWebSources = require('../core/article-chat-web-sources.js');

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

test('full-text chat can turn a natural-language intent into editable source highlights', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const content = read('content.js');
  const categories = read('core/category-store.js');
  assert.match(html, /id="articleChatHighlightCategory"/);
  assert.match(html, /id="highlightArticleChatMatches"/);
  assert.match(popup, /function submitArticleSemanticHighlight/);
  assert.match(popup, /action: 'highlightArticleMatchesWithLLM'/);
  assert.match(content, /function createSemanticAnnotationsFromTurn/);
  assert.match(content, /sourceType: 'semantic'/);
  assert.match(content, /ensureAutomaticHighlightAnnotation/);
  assert.match(categories, /semantic_match/);
});

test('chat supports color selection, outline-scoped @ context, and slash quick prompts', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const content = read('content.js');
  assert.match(html, /id="articleChatHighlightColor"[^>]*type="color"/);
  assert.match(html, /id="articleChatContextScopes"/);
  assert.match(html, /id="articleChatCommandMenu"[^>]*role="listbox"/);
  assert.match(popup, /function articleChatOutlineScopes/);
  assert.match(popup, /function articleChatQuickPrompts/);
  assert.match(popup, /function articleChatInputTrigger/);
  assert.match(popup, /trigger\.symbol === '@'/);
  assert.match(popup, /trigger\.symbol === '@'[\s\S]*articleChatOutlineScopes/);
  assert.match(popup, /articleChatContextScopePayload\(\)/);
  assert.match(popup, /highlightColor/);
  assert.match(content, /normalizeArticleChatContextScope/);
  assert.match(content, /resolveCurrentArticleChatScope/);
  assert.match(content, /selectedSectionIds\.has\(selectedEvidenceParagraph\.sectionId\)/);
  assert.match(content, /highlightCategoryName/);
  assert.match(content, /categoryColor:\s*turn\.highlightColor/);
});

test('chat composer keeps web, model, and send in one compact toolbar and dismisses command menus', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const css = read('popup.css');
  assert.match(html, /class="article-chat-input-row"/);
  assert.match(html, /class="article-chat-submit-controls"[\s\S]*id="articleChatWebSearch"[\s\S]*id="articleChatProfile"[\s\S]*id="sendArticleChat"/);
  assert.doesNotMatch(html, /id="cancelArticleChat"/);
  assert.doesNotMatch(html, /Shift\+Enter|限定大纲章节|插入全局快捷提示词/);
  assert.doesNotMatch(html, /<label[^>]*for="articleChatHighlightCategory"[^>]*>匹配类别<\/label>/);
  assert.match(
    css,
    /\.article-chat-submit-controls\s*\{[^}]*display:\s*flex/
  );
  assert.match(css, /#sendArticleChat\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/);
  assert.match(css, /\.article-chat-highlight-row \.btn\s*\{[^}]*justify-content:\s*center/);
  assert.match(popup, /event\.key === 'Escape'[\s\S]*closeArticleChatCommandMenu\(\)/);
  assert.match(popup, /document\.addEventListener\('pointerdown'[\s\S]*closeArticleChatCommandMenu\(\)/);
  assert.match(popup, /send\.dataset\.mode\s*=\s*loading\s*\?\s*'cancel'\s*:\s*'send'/);
  assert.match(popup, /send\?\.dataset\.mode\s*===\s*'cancel'/);
});

test('chat composer exposes an accessible per-turn web-search preference', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const css = read('popup.css');
  const toggle = html.match(/<button[^>]*id="articleChatWebSearch"[^>]*>/)?.[0] || '';
  const submit = popup.slice(
    popup.indexOf('async function submitArticleChat'),
    popup.indexOf('async function submitArticleSemanticHighlight')
  );

  assert.match(toggle, /type="button"/);
  assert.match(toggle, /aria-pressed="false"/);
  assert.match(toggle, /aria-label="[^"]*联网[^"]*"/);
  assert.match(toggle, /title="[^"]*联网[^"]*"/);
  assert.match(popup, /let articleChatWebSearchEnabled = false/);
  assert.match(popup, /function syncArticleChatWebSearchToggle/);
  assert.match(popup, /articleChatWebSearch.*addEventListener\('click'/s);
  const toggleStart = popup.indexOf('function syncArticleChatWebSearchToggle(');
  const toggleEnd = popup.indexOf('\nfunction renderArticleChatSnapshot', toggleStart);
  const clickStart = popup.indexOf("document.getElementById('articleChatWebSearch')?.addEventListener('click'");
  const clickEnd = popup.indexOf("document.getElementById('addArticleChatAttachment')", clickStart);
  assert.ok(toggleStart >= 0 && toggleEnd > toggleStart && clickStart >= 0 && clickEnd > clickStart);
  const attributes = {}, label = { textContent: '' }; let click;
  const button = { dataset: {}, setAttribute: (key, value) => { attributes[key] = value; },
    querySelector: () => label, addEventListener: (type, callback) => { assert.equal(type, 'click'); click = callback; } };
  const scope = vm.createContext({ document: { getElementById: id => id === 'articleChatWebSearch' ? button : null },
    currentWorkspaceSnapshot: { chat: { loading: true } }, articleChatSubmitPending: true,
    articleChatWebSearchMode: 'off', articleChatWebSearchEnabled: false });
  vm.runInContext(popup.slice(toggleStart, toggleEnd) + '\n' + popup.slice(clickStart, clickEnd), scope);
  scope.syncArticleChatWebSearchToggle();
  assert.equal(attributes['aria-pressed'], 'false'); assert.equal(button.dataset.searchMode, 'off');
  assert.equal(button.disabled, false, 'next-turn preference stays available while the prior turn is running');
  const frozenStatement = submit.match(/const webSearch = Object\.freeze\(\{[^]*?\}\);/)?.[0];
  assert.ok(frozenStatement, 'submission must freeze a per-turn preference');
  let firstSubmitted;
  for (const [mode, enabled, pressed] of [['on', true, 'true'], ['auto', false, 'true'], ['off', false, 'false']]) {
    click();
    const submitted = vm.runInContext(`(() => { ${frozenStatement} return webSearch; })()`, scope);
    assert.equal(button.dataset.searchMode, mode); assert.equal(attributes['aria-pressed'], pressed);
    assert.equal(submitted.mode, mode); assert.equal(submitted.enabled, enabled); assert.equal(Object.isFrozen(submitted), true);
    assert.match(attributes['aria-label'], /本轮.*点击切换联网模式/);
    if (mode === 'on') firstSubmitted = submitted;
  }
  assert.equal(firstSubmitted.mode, 'on'); assert.equal(firstSubmitted.enabled, true,
    'later preference clicks cannot rewrite an already submitted turn');
  assert.match(submit, /action: 'askArticleWithLLM',[\s\S]{0,220}webSearch/);
  assert.match(css, /\.article-chat-web-search-toggle\[aria-pressed="true"\]/);
});

test('web-grounded answers render only structured HTTPS sources as safe source dots', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const start = popup.indexOf('function isUnsafeArticleChatWebHostname');
  const end = popup.indexOf('function appendArticleChatEvidence', start);
  assert.ok(start >= 0 && end > start, 'expected isolated web-source renderer helpers');

  const created = [];
  const document = {
    createElement(tagName) {
      const node = {
        tagName: String(tagName).toUpperCase(),
        dataset: {},
        attributes: {},
        textContent: '',
        setAttribute(name, value) { this.attributes[name] = String(value); }
      };
      created.push(node);
      return node;
    }
  };
  const helpers = vm.runInNewContext(`${popup.slice(start, end)}\n({
    normalizeArticleChatWebSource,
    articleChatWebSourcesForBlock,
    createArticleChatWebSourceLink,
    articleChatWebGroundingRevision
  })`, { URL, document, SciLLM: ArticleChatWebSources });

  const turn = {
    answer: '[伪造链接](https://model.example/never-trust)',
    webGrounding: {
      receiptId: 'receipt-7',
      grounding: {
        providerResponseId: 'response-7',
        sources: [
          { sourceId: 'one', url: 'https://trusted.example.org/paper', title: '<b>可信论文</b>', blockIds: ['b1'] },
          { sourceId: 'duplicate', url: 'https://trusted.example.org/paper', title: '重复', blockIds: ['b1'] },
          { sourceId: 'two', url: 'https://second.example.org/result', title: '第二来源', blockIds: ['b2'] },
          { sourceId: 'script', url: 'javascript:alert(1)', title: '脚本', blockIds: ['b1'] },
          { sourceId: 'plain-http', url: 'http://public.example.org/result', title: '明文', blockIds: ['b1'] },
          { sourceId: 'local', url: 'https://localhost/admin', title: '本机', blockIds: ['b1'] },
          { sourceId: 'private', url: 'https://127.0.0.1/admin', title: '回环', blockIds: ['b1'] }
        ]
      }
    }
  };

  const firstBlock = helpers.articleChatWebSourcesForBlock(turn, 'b1');
  assert.equal(firstBlock.length, 1);
  assert.equal(firstBlock[0].url, 'https://trusted.example.org/paper');
  assert.equal(firstBlock[0].title, '<b>可信论文</b>');
  assert.deepEqual(
    Array.from(helpers.articleChatWebSourcesForBlock(turn, '', true), source => source.url),
    ['https://trusted.example.org/paper', 'https://second.example.org/result']
  );
  assert.equal(helpers.normalizeArticleChatWebSource({
    url: 'https://user:secret@trusted.example.org/private', blockIds: ['b1']
  }), null);
  for (const url of [
    'https://safe.onion/result',
    'https://[::ffff:8.8.8.8]/result',
    'https://[2002:808:808::]/result'
  ]) {
    assert.equal(helpers.normalizeArticleChatWebSource({ url, blockIds: ['b1'] }), null);
  }

  const link = helpers.createArticleChatWebSourceLink(firstBlock[0], 1);
  assert.equal(created.at(-1), link);
  assert.equal(link.tagName, 'A');
  assert.equal(link.href, 'https://trusted.example.org/paper');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.referrerPolicy, 'no-referrer');
  assert.equal(link.textContent, '1');
  assert.match(link.title, /<b>可信论文<\/b>/);
  assert.match(link.attributes['aria-label'], /trusted\.example\.org/);
  assert.match(helpers.articleChatWebGroundingRevision(turn, 'b1'), /^receipt-7:response-7:/);

  const providerUnverifiedTurn = {
    ...turn,
    answerProvenance: {
      origin: 'provider_unverified', verification: 'unverified'
    }
  };
  assert.deepEqual(
    Array.from(helpers.articleChatWebSourcesForBlock(providerUnverifiedTurn, 'b1')),
    [],
    'provider-unverified answers must not expose trusted source links'
  );
  assert.equal(helpers.articleChatWebGroundingRevision(providerUnverifiedTurn, 'b1'), 'source-unverified');
  assert.deepEqual(Array.from(helpers.articleChatWebSourcesForBlock({ ...turn,
    answerProvenance: { origin: 'external_import', verification: 'unverified' }
  }, 'b1')), []);

  const markdownStart = popup.indexOf('function appendArticleChatInlineMarkdown');
  const markdownEnd = popup.indexOf('function normalizeArticleChatMarkdown', markdownStart);
  assert.doesNotMatch(popup.slice(markdownStart, markdownEnd), /createElement\(['"]a['"]\)/);
  assert.match(popup.slice(start, end), /turn\?\.webGrounding\?\.grounding\?\.sources/);
  assert.doesNotMatch(popup.slice(start, end), /turn\?\.webGrounding\?\.sources/);
  assert.doesNotMatch(popup.slice(start, end), /turn\?\.answer(?!Provenance)|markdown/i);
  assert.match(css, /\.article-chat-web-source-dot/);
  assert.match(css, /\.article-chat-web-sources/);
});

test('web-source revisions repaint keyed answer blocks and web errors are actionable', () => {
  const popup = read('popup.js');
  const renderStart = popup.indexOf('function renderArticleChatBlock');
  const renderEnd = popup.indexOf('function isArticleChatNearBottom', renderStart);
  const renderer = popup.slice(renderStart, renderEnd);

  assert.match(renderer, /dataset\.webGroundingRevision/);
  assert.match(renderer, /articleChatWebGroundingRevision\(\s*turn,\s*blockId/);
  assert.match(renderer, /existing\.dataset\.webGroundingRevision\s*!==\s*webGroundingRevision/);
  assert.match(renderer, /turn\?\.answer/);
  assert.match(renderer, /allSources:\s*true/);
  assert.match(popup, /WEB_SEARCH_UNSUPPORTED:\s*'[^']*不支持联网搜索/);
  assert.match(popup, /(?:WEB_SEARCH_)?GROUNDING_MISSING:\s*'[^']*可核验来源/);
  assert.match(popup, /(?:WEB_SEARCH_)?RESPONSE_INCOMPLETE:\s*'[^']*未完整/);
  assert.match(popup, /function articleChatFailureText/);
});

test('external archive answers render a localized persistent unverified provenance label', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const importer = popup.slice(
    popup.indexOf('async function importCurrentArticleArchive'),
    popup.indexOf('function currentLocalArticleWorkspace')
  );
  const renderer = popup.slice(
    popup.indexOf('function renderArticleChatTurn'),
    popup.indexOf('function isArticleChatNearBottom')
  );

  assert.match(importer, /markArticleArchiveAsExternalImport/);
  assert.match(renderer, /answerProvenance\?\.origin\s*===\s*'external_import'/);
  assert.match(renderer, /answerProvenance\?\.verification\s*===\s*'unverified'/);
  assert.match(renderer, /t\('外部导入 · 来源未验证'\)/);
  assert.match(renderer, /is-unverified-import/);
  assert.match(css, /\.article-chat-message-meta\.is-unverified-import/);
});

test('provider-unverified web answers show a distinct warning and suppress trusted links', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const webHelpers = popup.slice(
    popup.indexOf('function isUnsafeArticleChatWebHostname'),
    popup.indexOf('function appendArticleChatEvidence')
  );
  const renderer = popup.slice(
    popup.indexOf('function renderArticleChatTurn'),
    popup.indexOf('function isArticleChatNearBottom')
  );

  assert.match(webHelpers,
    /\['external_import', 'provider_unverified'\]\.includes\(turn\?\.answerProvenance\?\.origin\)/);
  assert.match(popup, /const evidence = isUnverifiedArticleChatTurn\(turn\) \? \[\] : block\.evidence/);
  assert.match(renderer,
    /answerProvenance\?\.origin\s*===\s*'provider_unverified'/);
  assert.match(renderer, /t\('联网回答 · 来源未验证'\)/);
  assert.match(renderer, /is-unverified-source/);
  assert.match(css, /\.article-chat-message-meta\.is-unverified-source/);
  assert.match(css, /\.article-chat-message-meta\.is-unverified-import/);
});

test('outline-scoped chat commands include sections whose paragraphs live in descendants', () => {
  const popup = read('popup.js');
  const start = popup.indexOf('function articleChatOutlineScopes');
  const end = popup.indexOf('function articleChatQuickPrompts', start);
  const helper = popup.slice(start, end);
  assert.match(helper, /node\?\.analysisSectionIds/);
  assert.match(helper, /sectionIds\.includes\(String\(paragraph\?\.sectionId/);
  assert.doesNotMatch(helper, /node\?\.paragraphCount\s*>\s*0/);
  assert.doesNotMatch(helper, /&&\s*paragraphCount\s*>\s*0/);
  assert.doesNotMatch(helper, /slice\(0,\s*120\)/);
});

test('content sends canonical workspace paragraphs and persists only public chat state', () => {
  const content = read('content.js');
  const popup = read('popup.js');
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
  assert.match(content, /chat:\s*getPublicArticleChatState\(\{ limit: chatLimit \}\)/);
  const publicPlanStart = content.indexOf('function publicArticleChatPlan');
  const publicPlanEnd = content.indexOf(
    'function normalizeArticleChatContextScope', publicPlanStart
  );
  const publicPlan = content.slice(publicPlanStart, publicPlanEnd);
  assert.match(publicPlan, /contextWindowTokenCount/);
  assert.match(publicPlan, /inputBudgetTokenCount/);
  assert.doesNotMatch(publicPlan, /\n\s*contextWindowTokens\s*:/);
  assert.match(content, /function articleChatFailureMessage/);
  assert.match(content, /OUTPUT_TRUNCATED:\s*'模型连续达到输出上限/);
  assert.match(content, /'completed', 'truncated', 'incomplete'/);
  assert.match(popup, /turn\.status === 'incomplete'/);
  assert.doesNotMatch(popup, /已保留完整回答；模型续写后仍达到输出上限/);
});

test('full-text chat reports when a very long paper used a relevance-bounded context', () => {
  const core = read('core/article-chat.js');
  const popup = read('popup.js');
  assert.doesNotMatch(core, /ARTICLE_CHAT_MAX_CONTEXT_CHARS|selectArticleChatContext/);
  assert.match(core, /planArticleChatContext/);
  assert.match(core, /retrievalCoverage/);
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
  assert.match(popup, /<sup>\[\^<\\n\]\+<\\\/sup>/);
  assert.match(popup, /createWorkspaceElement\(\s*scriptMatch\[1\]/);
  assert.match(popup, /createWorkspaceElement\(ordered \? 'ol' : 'ul'\)/);
  assert.doesNotMatch(popup, /articleChatMessages[\s\S]{0,500}innerHTML/);
  assert.doesNotMatch(popup, /role === 'assistant'[\s\S]{0,220}:\s*['"](?:你|我)['"]/);
  assert.match(popup, /kind:\s*'paragraph'/);
  assert.match(popup, /paragraphId/);
  assert.match(popup, /sourceKey/);
  assert.match(popup, /article-chat-inline-citation/);
  assert.match(popup, /focusArticleChatCitation/);
  assert.match(popup, /inlineCitationCount/);
  assert.match(popup, /citationNumberOffset/);
  assert.match(popup, /dataset\.citationNumber/);
  assert.match(popup, /articleChatOrderedListItemCount/);
  assert.match(popup, /dataset\.orderedListStart/);
  assert.match(popup, /list\.start = start/);
  assert.match(popup, /\\d\{1,3\}/);
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
  assert.match(citationWorkflow, /dataset\.citationNumber/);
  assert.doesNotMatch(citationWorkflow, /paragraphs\.find[\s\S]*candidateTitle === sectionTitle/);
  assert.match(citationWorkflow, /documentRevision/);
  assert.match(citationWorkflow, /citationResult/);
  assert.match(citationWorkflow, /applyArticleChatCitationState/);
  assert.match(
    citationWorkflow,
    /paragraphId:\s*verification\.target\.paragraphId\s*\|\|\s*item\?\.paragraphId/
  );
  const content = read('content.js');
  assert.match(content, /data-sci-llm-paragraph-id/);
  assert.match(content, /paragraphId:\s*verified\?\.target\?\.paragraphId/);
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

test('completed Figures publish an immediate workspace event and checkpoint before the batch ends', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const start = content.indexOf('async function analyzeFiguresWithLLM');
  const end = content.indexOf('function setReviewOutlineDepth', start);
  const workflow = content.slice(start, end);
  assert.match(content, /function notifyFigureWorkspaceStateChanged\(/);
  assert.match(workflow, /notifyFigureWorkspaceStateChanged\('figure_completed'/);
  assert.match(workflow, /scheduleArticleWorkspaceArtifactsSave\(\{ immediate: true \}\)/);
  assert.match(popup, /message\?\.type === 'FIGURE_WORKSPACE_STATE_CHANGED'/);
  assert.match(popup, /void refreshArticleWorkspace/);
});

test('every progressive LLM surface captures an immutable immediate workspace checkpoint', () => {
  const content = read('content.js');
  const router = read('core/background-router.js');
  const progressive = content.slice(
    content.indexOf('function renderProgressiveLlmChunk'),
    content.indexOf('function closeLlmFeedbackPopover')
  );
  const figureCheckpoint = content.slice(
    content.indexOf('async function applyPrivateFigureCheckpoint'),
    content.indexOf('async function commitFigurePartialCheckpoint')
  );
  assert.match(progressive, /scheduleArticleWorkspaceArtifactsSave\(\{ immediate: true \}\)/);
  assert.match(figureCheckpoint, /figure_checkpoint/);
  assert.match(figureCheckpoint, /commitFigurePartialCheckpoint/);
  assert.match(content, /function captureArticleWorkspaceAssets\(/);
  assert.match(content, /async function persistArticleWorkspaceArtifacts\(\{/);
  assert.match(content, /force = false[\s\S]{0,100}assets = null/);
  assert.match(content, /const assets = captureArticleWorkspaceAssets\(\)/);
  const checkpointStart = content.indexOf("if (progress.phase === 'review_chunk_checkpoint')");
  assert.ok(checkpointStart >= 0, 'actual review checkpoint branch must exist');
  const checkpointEnd = content.indexOf('const completedParagraphs =', checkpointStart);
  assert.ok(checkpointEnd > checkpointStart, 'checkpoint branch must precede progress rendering');
  const checkpointBlock = content.slice(checkpointStart, checkpointEnd);
  assert.match(checkpointBlock, /scheduleArticleWorkspaceArtifactsSave\(\{ immediate: true \}\)/);
  assert.match(router, /phase:\s*'review_chunk_checkpoint'/);
});

test('side panel can explicitly save all current workspace artifacts to the local folder', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const content = read('content.js');
  assert.match(html, /id="saveCurrentArticleWorkspace"/);
  assert.match(popup, /async function saveCurrentArticleWorkspace\(/);
  assert.match(popup, /action:\s*'saveArticleWorkspaceNow'/);
  assert.match(popup, /type:\s*'USER_DATA_SYNC_NOW'/);
  assert.match(popup, /drain:\s*true/);
  assert.match(popup, /directorySyncFailureMessage\(syncResult\)/);
  assert.match(popup, /let saved = null;/);
  assert.match(
    popup,
    /本次结果已保存在浏览器；文件夹同步尚未完成。[\s\S]{0,160}error\?\.message/
  );
  assert.doesNotMatch(popup, /文件夹同步将自动重试，可以放心关闭页面/);
  assert.match(content, /request\.action === 'saveArticleWorkspaceNow'/);
  const explicitSave = content.slice(
    content.indexOf('async function saveCurrentArticleWorkspaceNow'),
    content.indexOf('function scheduleArticleWorkspaceArtifactsSave')
  );
  assert.match(explicitSave, /persistArticleWorkspaceArtifacts\(\{/);
  assert.doesNotMatch(explicitSave, /force:\s*true/);
  assert.match(explicitSave, /persistWorkspaceTurnCheckpoint\(turn, \{[\s\S]{0,100}append: false/);
  assert.match(explicitSave, /articleWorkspaceMutationTail/);
  assert.match(explicitSave, /createWorkspaceSaveTransactionContext/);
  assert.match(explicitSave, /capturedTurns/);
  assert.match(explicitSave, /articleWorkspaceExplicitSaveState/);
  assert.match(explicitSave, /retryLimit/);
  assert.match(explicitSave, /WORKSPACE_CONTAINS_CREDENTIALS/);
  assert.match(explicitSave, /unsafeSkipped/);
});

test('explicit save pauses and coalesces autosave instead of racing the captured transaction', () => {
  const content = read('content.js');
  const schedule = content.slice(
    content.indexOf('function scheduleArticleWorkspaceArtifactsSave'),
    content.indexOf('function createPortableFigureWorkspaceArchiveFields')
  );
  assert.match(schedule, /articleWorkspaceExplicitSaveState\.paused/);
  assert.match(schedule, /pendingAutosave\s*=\s*true/);
  const save = content.slice(
    content.indexOf('async function saveCurrentArticleWorkspaceNow'),
    content.indexOf('function scheduleArticleWorkspaceArtifactsSave')
  );
  assert.match(save, /clearTimeout\(articleWorkspaceSaveTimer\)/);
  assert.match(save, /await articleWorkspaceMutationTail/);
  assert.match(save, /articleWorkspaceExplicitSaveState\.active/);
  assert.match(save, /pendingAutosave[\s\S]*scheduleArticleWorkspaceArtifactsSave/);
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
  assert.match(workflow, /terminalTurn\.plan = publicArticleChatPlan\(response\.data\.plan\)/);
  assert.match(workflow, /function pumpArticleChatQueue/);
  assert.doesNotMatch(workflow, /\.slice\(-20\)|\.slice\(-40\)/);
});

test('workspace autosave checkpoints complete chat blocks and keeps interrupted tasks inert', () => {
  const content = read('content.js');
  assert.match(content, /function ensureCurrentArticleWorkspace/);
  assert.match(content, /type:\s*'ARTICLE_WORKSPACE_ENSURE'/);
  assert.match(content, /function persistWorkspaceAssetCheckpoint/);
  assert.match(content, /chat\/turns\//);
  assert.match(content, /phase === 'chat_answer_block'[\s\S]{0,900}persistArticleChatCheckpoint/);
  assert.match(content,
    /async function persistArticleChatCheckpoint[\s\S]{0,700}chat\/index\.json/);
  assert.match(content,
    /await persistArticleChatCheckpoint\(terminalTurn, \{[\s\S]{0,180}force:\s*true[\s\S]{0,180}requireTurnSave:\s*true/);
  assert.match(content,
    /phase === 'chat_completed'[\s\S]{0,800}pendingTerminalStatus/);
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

test('side panel pages large chat histories without limiting persisted history', () => {
  const content = read('content.js');
  const popup = read('popup.js');

  assert.match(content, /function getPublicArticleChatState\(options = \{\}\)/);
  assert.match(content, /const requestedLimit =/);
  assert.match(content, /articleChatState\.turns\.slice\(windowStart\)/);
  assert.match(content, /function buildArticleWorkspaceSnapshot\(\{ forceRefresh = false, chatLimit = 0 \} = \{\}\)/);
  assert.match(content, /chat:\s*getPublicArticleChatState\(\{ limit: chatLimit \}\)/);
  assert.match(content,
    /async function persistArticleChatCheckpoint[\s\S]{0,700}getPublicArticleChatState\(\)/);
  assert.match(popup, /chatLimit:\s*Math\.max\(articleChatHistoryPageSize, articleChatVisibleTurnCount\)/);
  assert.match(popup, /async function loadEarlierArticleChatHistory\(\)/);
  assert.match(popup, /const snapshot = await refreshArticleWorkspace\(\)/);
  assert.match(popup, /container\.style\.overflowAnchor = 'none'/);
  assert.match(popup, /anchor\.getBoundingClientRect\(\)\.top - anchorTop/);
  assert.match(popup, /const visibleTurns = turns;/);
  assert.match(popup, /articleChatVisibleTurnCount,/);
});

test('explicit local save reports privacy-safe stages and keeps directory sync single-pass', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const css = read('popup.css');
  const saveContent = content.slice(
    content.indexOf('function reportArticleWorkspaceSaveProgress'),
    content.indexOf('function scheduleArticleWorkspaceArtifactsSave')
  );
  const progressReporter = content.slice(
    content.indexOf('function reportArticleWorkspaceSaveProgress'),
    content.indexOf('async function persistOfflineArticleSnapshot')
  );
  const savePopup = popup.slice(
    popup.indexOf('const ARTICLE_WORKSPACE_SAVE_STAGES'),
    popup.indexOf('function applyRestoredSidePanelUiState')
  );

  assert.match(saveContent, /ARTICLE_WORKSPACE_SAVE_PROGRESS/);
  assert.match(saveContent, /operationId/);
  assert.match(saveContent, /reportArticleWorkspaceSaveProgress\(operationId, 'content'/);
  assert.match(saveContent, /reportArticleWorkspaceSaveProgress\(operationId, 'figures'/);
  assert.match(saveContent, /reportArticleWorkspaceSaveProgress\(operationId, 'offline'/);
  assert.match(saveContent, /onProgress:\s*\(\)\s*=>/);
  assert.match(saveContent, /completedCount:\s*contentCompleted/);
  assert.doesNotMatch(progressReporter,
    /paragraphs:\s*|annotations:\s*|turns:\s*articleChatState\.turns/);
  assert.match(savePopup, /permission[\s\S]*content[\s\S]*figures[\s\S]*offline[\s\S]*sync/);
  assert.match(savePopup, /renderArticleWorkspaceSaveProgress/);
  assert.match(savePopup, /action:\s*'saveArticleWorkspaceNow'[\s\S]*operationId/);
  assert.match(savePopup, /type:\s*'ARTICLE_WORKSPACE_MIRROR_ALL'/);
  assert.equal((savePopup.match(/type:\s*'USER_DATA_SYNC_NOW'/g) || []).length, 1);
  assert.match(css, /\.article-workspace-save-progress/);
  assert.match(css, /\.article-workspace-save-stage\.is-active/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test('explicit offline saves refresh resource closure even when canonical article text is unchanged', () => {
  const content = read('content.js');
  const source = content.slice(
    content.indexOf('async function persistOfflineArticleSnapshot'),
    content.indexOf('async function persistLocalLibrarySaveEvent')
  );
  assert.doesNotMatch(source, /offlineArticleSnapshotBuildCache/);
  assert.match(source, /collectFaithfulSnapshotResources/);
  assert.match(source, /reused:\s*false/);
  assert.match(source, /persistWorkspaceAssetCheckpoint\([\s\S]*OFFLINE_ARTICLE_SNAPSHOT_PATH/);
  assert.match(source, /requireDirectoryPersistence:\s*true/);
  assert.doesNotMatch(source, /force:\s*true/);
});

test('citation focus retries one forced extraction after translated DOM replacement', () => {
  const content = read('content.js');
  const start = content.indexOf('function verifyAndFocusArticleChatCitation');
  const end = content.indexOf('function focusFigureFollowupParagraphSource', start);
  const focus = content.slice(start, end);
  assert.match(focus, /extractCurrentArticleStructure\(\{\s*forceRefresh:\s*true\s*\}\)/);
  assert.match(focus, /bindingRetried/);
  assert.match(focus, /SOURCE_ANCHOR_MISSING/);
});

test('article chat persists the document hash as a hard cross-document citation boundary', () => {
  const content = read('content.js');
  const popup = read('popup.js');
  const normalize = content.slice(
    content.indexOf('function normalizeArticleChatEvidence'),
    content.indexOf('function publicArticleChatBlock')
  );
  const attach = content.slice(
    content.indexOf('function attachArticleChatEvidenceIdentity'),
    content.indexOf('/* Legacy flat-message workflow')
  );
  const focus = popup.slice(
    popup.indexOf('async function focusArticleChatCitation'),
    popup.indexOf('function appendArticleChatMarkdown')
  );
  assert.match(normalize, /documentHash/);
  assert.match(attach, /snapshot\?\.documentHash/);
  assert.match(focus, /documentHash:\s*item\?\.documentHash \|\| snapshot\?\.documentHash/);
});
