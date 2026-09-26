const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ArticleChat = require('../core/article-chat.js');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');

test('every production scope caller loads its resolver before running content or popup', () => {
  const { CONTENT_SCRIPT_FILES } = require('../core/tab-messenger.js');
  const resolverIndex = CONTENT_SCRIPT_FILES.indexOf('core/article-chat.js');
  assert.ok(resolverIndex >= 0 && resolverIndex < CONTENT_SCRIPT_FILES.indexOf('content.js'),
    'web content must load the scope resolver, not just the sidebar and background');
  for (const [file, consumer] of [['pdf-reader.html', 'content.js'], ['popup.html', 'popup.js']]) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
    assert.ok(scripts.indexOf('core/article-chat.js') >= 0 &&
      scripts.indexOf('core/article-chat.js') < scripts.indexOf(consumer), file);
  }
});

function sourceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startText}`);
  return source.slice(start, end);
}

function fixture() {
  return {
    nodes: [
      {
        sectionId: 'current-methods', sourceKey: 'heading-methods',
        title: 'Materials and methods', children: [
          { sectionId: 'method-surgery', sourceKey: 'heading-surgery',
            title: 'Stereotaxic surgery', children: [] },
          { sectionId: 'method-imaging', sourceKey: 'heading-imaging',
            title: 'Imaging', children: [] }
        ]
      },
      { sectionId: 'results', sourceKey: 'heading-results', title: 'Results', children: [] }
    ],
    paragraphs: [
      { paragraphId: 'm1', sectionId: 'method-surgery', sectionKind: 'methods',
        sectionTitle: 'Stereotaxic surgery', text: 'Coordinates were recorded.' },
      { paragraphId: 'm2', sectionId: 'method-imaging', sectionKind: 'methods',
        sectionTitle: 'Imaging', text: 'Images were acquired.' },
      { paragraphId: 'r1', sectionId: 'results', sectionKind: 'results',
        sectionTitle: 'Results', text: 'A result outside the requested scope.' }
    ]
  };
}

test('parent Methods resolves its descendants even when the parent owns no prose', () => {
  const resolved = ArticleChat.resolveArticleChatContextScope({
    scopes: [{ scopeId: 'current-methods', name: 'Methods',
      sectionIds: ['current-methods'], sourceKeys: ['heading-methods'] }],
    sectionIds: ['current-methods'], sectionTitles: ['Methods']
  }, fixture());
  assert.equal(resolved.requested, true);
  assert.equal(resolved.complete, true);
  assert.deepEqual(resolved.sectionIds, ['method-surgery', 'method-imaging']);
  assert.deepEqual(resolved.paragraphIds, ['m1', 'm2']);
});

test('stale IDs rebind through stable source keys or a unique Methods alias', () => {
  const bySource = ArticleChat.resolveArticleChatContextScope({
    scopes: [{ scopeId: 'old-methods', name: 'Methods',
      sectionIds: ['old-methods'], sourceKeys: ['heading-methods'] }]
  }, fixture());
  assert.equal(bySource.complete, true);
  assert.deepEqual(bySource.paragraphIds, ['m1', 'm2']);

  const byAlias = ArticleChat.resolveArticleChatContextScope({
    scopes: [{ scopeId: 'older-methods', name: 'Methods',
      sectionIds: ['older-methods'], sourceKeys: [] }]
  }, fixture());
  assert.equal(byAlias.complete, true);
  assert.deepEqual(byAlias.paragraphIds, ['m1', 'm2']);

  for (const name of ['Materials & Methods', 'Materials and Methods', 'STAR Methods']) {
    const aliased = ArticleChat.resolveArticleChatContextScope({
      scopes: [{ scopeId: `stale-${name}`, name, sectionIds: ['stale'] }]
    }, fixture());
    assert.equal(aliased.complete, true, name);
    assert.deepEqual(aliased.paragraphIds, ['m1', 'm2'], name);
  }
});

test('unknown or ambiguous stale scopes fail closed instead of selecting the article', () => {
  const unknown = ArticleChat.resolveArticleChatContextScope({
    scopes: [{ scopeId: 'gone', name: 'Unavailable section', sectionIds: ['gone'] }]
  }, fixture());
  assert.equal(unknown.requested, true);
  assert.equal(unknown.complete, false);
  assert.deepEqual(unknown.paragraphIds, []);

  const duplicate = fixture();
  duplicate.nodes.push({
    sectionId: 'other-methods', sourceKey: 'other-methods-heading',
    title: 'Experimental procedures', children: []
  });
  duplicate.paragraphs.push({
    paragraphId: 'm3', sectionId: 'other-methods', sectionKind: 'methods',
    sectionTitle: 'Experimental procedures', text: 'A separate methods appendix.'
  });
  const ambiguous = ArticleChat.resolveArticleChatContextScope({
    scopes: [{ scopeId: 'stale', name: 'Methods', sectionIds: ['stale'] }]
  }, duplicate);
  assert.equal(ambiguous.complete, false);
  assert.deepEqual(ambiguous.paragraphIds, []);
});

test('content preflights scope before creating a turn and explicit scope bypasses analysis toggles', () => {
  const resolverStart = content.indexOf('function resolveCurrentArticleChatScope(');
  const resolverEnd = content.indexOf('function articleChatRequestQuestion(', resolverStart);
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);
  const resolverSource = content.slice(resolverStart, resolverEnd);
  assert.match(resolverSource, /resolveArticleChatContextScope/);
  assert.match(resolverSource, /resolution\.requested[\s\S]*resolution\.paragraphIds/);
  assert.match(resolverSource, /filterParagraphsForArticleAnalysis/);

  const askStart = content.indexOf('async function askArticleWithLLM(');
  const askEnd = content.indexOf('async function cancelArticleChatWithLLM', askStart);
  const askSource = content.slice(askStart, askEnd);
  assert.ok(askStart >= 0 && askEnd > askStart);
  assert.ok(askSource.indexOf('resolveCurrentArticleChatScope') <
    askSource.indexOf('createArticleChatTurn'));
});

test('popup sends stable scope descriptors and both actions localize empty scope failures', () => {
  assert.match(popupHtml, /core\/article-chat\.js/);
  const payloadStart = popup.indexOf('function articleChatContextScopePayload()');
  const payloadEnd = popup.indexOf('function articleChatInputTrigger', payloadStart);
  const payload = popup.slice(payloadStart, payloadEnd);
  assert.match(payload, /scopes/);
  assert.match(payload, /sourceKeys/);
  assert.match(popup, /ARTICLE_CHAT_SCOPE_EMPTY:\s*'[^']*章节/);
  const highlightStart = popup.indexOf('async function submitArticleSemanticHighlight');
  const highlightEnd = popup.indexOf('async function cancelArticleChat', highlightStart);
  assert.match(popup.slice(highlightStart, highlightEnd), /articleChatFailureText\(error/);
});

test('production content resolver keeps scoped Methods despite the default analysis filter', () => {
  const normalizeSource = sourceBetween(content,
    'function normalizeArticleChatContextScope(',
    'function articleChatTurnAnswerText(');
  const resolverSource = sourceBetween(content,
    'function resolveCurrentArticleChatScope(',
    'function articleChatRequestQuestion(');
  const sandbox = {
    SciLLM: ArticleChat,
    getCanonicalArticleSnapshot: () => fixture(),
    filterParagraphsForArticleAnalysis: paragraphs =>
      paragraphs.filter(item => item.sectionKind === 'results')
  };
  vm.runInNewContext(`${normalizeSource}\n${resolverSource}`, sandbox);
  const scoped = sandbox.resolveCurrentArticleChatScope({
    scopes: [{ scopeId: 'methods', name: 'Methods',
      sectionIds: ['current-methods'], sourceKeys: ['heading-methods'] }]
  }, fixture());
  assert.deepEqual(scoped.paragraphs.map(item => item.paragraphId), ['m1', 'm2']);

  const unscoped = sandbox.resolveCurrentArticleChatScope({}, fixture());
  assert.deepEqual(unscoped.paragraphs.map(item => item.paragraphId), ['r1']);
});

test('production content resolves Methods from semantic PDF identity without legacy fallback', () => {
  const normalizeSource = sourceBetween(content,
    'function normalizeArticleChatContextScope(',
    'function articleChatTurnAnswerText(');
  const semanticProjection = sourceBetween(content,
    'function pdfSemanticArticleChatSnapshot(',
    'function articleChatRequestQuestion(');
  const sandbox = {
    SciLLM: ArticleChat,
    refreshActivePdfSemanticNavigationContext: () => ({ navigation: { sections: [{
      sectionId: 'semantic-methods', title: 'Materials and methods', children: [{
        sectionId: 'semantic-surgery', title: 'Surgery', children: [],
        paragraphTargets: [{ kind: 'paragraph', paragraphId: 'semantic-p1',
          expectedNormalizedQuote: 'Coordinates were recorded.' }]
      }], paragraphTargets: []
    }] } }),
    flattenPdfSemanticNavigationSections(sections, output = []) {
      for (const section of sections || []) {
        output.push(section);
        sandbox.flattenPdfSemanticNavigationSections(section.children, output);
      }
      return output;
    },
    getCanonicalArticleSnapshot: () => fixture(),
    filterParagraphsForArticleAnalysis: () => {
      throw new Error('semantic PDF must not fall back to legacy whole-text filtering');
    }
  };
  const paragraphHashSource = sourceBetween(content,
    'function hashArticleChatParagraphText(', 'function isPdfSemanticHighlightLocator(');
  require('node:vm').runInNewContext(
    `${paragraphHashSource}\n${normalizeSource}\n${semanticProjection}`, sandbox);
  const scoped = sandbox.resolveCurrentArticleChatScope({
    scopes: [{ scopeId: 'methods', name: 'Methods',
      sectionIds: ['semantic-methods'], sourceKeys: ['semantic-methods'] }]
  }, fixture());
  assert.deepEqual(Array.from(scoped.paragraphs, item => item.paragraphId), ['semantic-p1']);
  assert.equal(scoped.resolution.complete, true);
});

test('production content ask preflight rejects an empty scope before creating a chat turn', async () => {
  const askSource = sourceBetween(content,
    'async function askArticleWithLLM(',
    'async function cancelArticleChatWithLLM(');
  let created = 0;
  let pushed = 0;
  const sandbox = {
    articleChatClearInFlight: false,
    resolveCurrentArticleChatScope: () => {
      const error = new Error('ARTICLE_CHAT_SCOPE_EMPTY');
      error.code = 'ARTICLE_CHAT_SCOPE_EMPTY';
      throw error;
    },
    createArticleChatTurn: () => { created += 1; return {}; },
    articleChatState: { turns: { push: () => { pushed += 1; } } },
    notifyArticleChatStateChanged() {},
    persistArticleChatCheckpoint: async () => {},
    scheduleCurrentArticleArchiveSave() {},
    pumpArticleChatQueue() {},
    publicArticleChatTurn: value => value
  };
  vm.runInNewContext(askSource, sandbox);
  await assert.rejects(
    sandbox.askArticleWithLLM('question', 'profile', {
      contextScope: { sectionIds: ['missing'] }
    }),
    error => error.code === 'ARTICLE_CHAT_SCOPE_EMPTY'
  );
  assert.equal(created, 0);
  assert.equal(pushed, 0);
});

test('production popup keeps chat scopes fail-closed and independent highlighting unscoped', async () => {
  const outlineSource = sourceBetween(popup,
    'function articleChatOutlineScopes(',
    'function selectedWorkspaceAnalysisSectionIds(');
  const payloadAndPreflightSource = sourceBetween(popup,
    'function articleChatContextScopePayload(',
    'function articleChatInputTrigger(');
  const chatSource = sourceBetween(popup,
    'async function submitArticleChat(',
    'async function submitArticleSemanticHighlight(');
  const highlightSource = sourceBetween(popup,
    'async function submitArticleSemanticHighlight(',
    'async function cancelArticleChat(');
  const snapshot = fixture();
  snapshot.nodes[0].analysisSectionIds = [
    'current-methods', 'method-surgery', 'method-imaging'
  ];
  let sent = 0;
  let sentMessage;
  const statuses = [];
  const elements = {
    articleChatQuestion: { value: 'all coordinates', focus() {} },
    articleChatProfile: { value: 'profile' },
    articleSemanticHighlightQuery: { value: 'independent query', focus() {} },
    articleSemanticHighlightProfile: { value: 'search-profile' },
    articleChatHighlightCategory: {
      value: 'semantic',
      selectedOptions: [{ dataset: { categoryName: 'Match' }, textContent: 'Match' }]
    },
    articleChatHighlightColor: { value: '#2F80ED' }
  };
  const sandbox = {
    SciLLM: ArticleChat,
    currentWorkspaceSnapshot: snapshot,
    articleChatContextScopes: new Map(),
    articleChatSubmitPending: false,
    articleChatWebSearchEnabled: false,
    llmSettingsState: { settings: { consentGranted: true } },
    document: { getElementById: id => elements[id] || null },
    showStatus: (message, level) => statuses.push({ message, level }),
    articleChatFailureText: value => value === 'ARTICLE_CHAT_SCOPE_EMPTY'
      ? '所选章节在当前论文正文中没有可用段落。' : String(value || ''),
    sendTabMessage: async (_tabId, message) => {
      sent += 1;
      sentMessage = message;
      return { success: true };
    },
    capturePanelContext: () => ({ tabId: 1 }),
    isCurrentPanelContext: () => true,
    closeArticleChatCommandMenu() {},
    syncArticleChatWebSearchToggle() {},
    renderArticleChatContextScopes() {},
    applyArticleChatStateEvent() {}
  };
  vm.runInNewContext([
    outlineSource, payloadAndPreflightSource, chatSource, highlightSource
  ].join('\n'), sandbox);
  const methods = sandbox.articleChatOutlineScopes(snapshot)
    .find(item => item.id === 'current-methods');
  assert.deepEqual(Array.from(methods.sectionIds), [
    'current-methods', 'method-surgery', 'method-imaging'
  ]);
  assert.deepEqual(Array.from(methods.sourceKeys), [
    'heading-methods', 'heading-surgery', 'heading-imaging'
  ]);

  sandbox.articleChatContextScopes.set('missing', {
    id: 'missing', name: 'Unavailable section',
    sectionIds: ['missing'], sourceKeys: ['missing']
  });
  await sandbox.submitArticleChat({ preventDefault() {} });
  assert.equal(sent, 0);
  assert.match(statuses.at(-1).message, /章节/);
  assert.equal(elements.articleChatQuestion.value, 'all coordinates');

  await sandbox.submitArticleSemanticHighlight({ preventDefault() {} });
  assert.equal(sent, 1);
  assert.equal(sentMessage.question, 'independent query');
  assert.equal(sentMessage.profileId, 'search-profile');
  assert.deepEqual(Array.from(sentMessage.contextScope.sectionIds), []);
  assert.deepEqual(Array.from(sentMessage.contextScope.scopes), []);
  assert.equal(elements.articleChatQuestion.value, 'all coordinates');
  assert.equal(elements.articleSemanticHighlightQuery.value, '');
  assert.equal(sandbox.articleChatContextScopes.has('missing'), true);
});
