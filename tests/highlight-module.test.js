const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `${name} must exist`);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/\n(?:async )?function \w+\(/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}
function select(value = '') {
  return {
    value, disabled: false, children: [],
    replaceChildren() { this.children = []; this.value = ''; },
    appendChild(option) { this.children.push(option); },
    get selectedOptions() { return this.children.filter(option => option.value === this.value); }
  };
}
function fixture({ reply = async () => ({ success: true }) } = {}) {
  const category = select('semantic_match');
  category.children.push({ value: 'semantic_match', textContent: 'Match',
    dataset: { categoryName: 'Match', categoryColor: '#2F80ED' } });
  const input = value => ({ value, focused: false, focus() { this.focused = true; } });
  const elements = {
    articleSemanticHighlightQuery: input('find independent evidence'),
    articleSemanticHighlightProfile: select('search-profile'),
    articleChatQuestion: input('private chat draft'),
    articleChatProfile: select('chat-profile'),
    articleChatHighlightCategory: category,
    articleChatHighlightColor: { value: '#118844' },
    highlightArticleChatMatches: { disabled: false }
  };
  const scopes = new Map([['chat-only', { id: 'chat-only', name: 'Hidden Methods',
    sectionIds: ['methods'], sourceKeys: ['methods-source'] }]]);
  const sent = [], statuses = [], events = [];
  const profiles = {
    'chat-profile': { name: 'Chat model', providerId: 'openai',
      config: { model: 'chat-model', hasApiKey: true } },
    'search-profile': { name: 'Search model', providerId: 'openai',
      config: { model: 'search-model', hasApiKey: true } }
  };
  const sandbox = {
    document: { getElementById: id => elements[id] || null,
      createElement: () => ({ dataset: {} }) },
    llmSettingsState: { settings: { consentGranted: true, globalProfileId: 'chat-profile',
      profiles, profileOrder: Object.keys(profiles) } },
    SciLLM: {}, t: value => value,
    articleChatSelectedProfileId: 'chat-profile',
    articleChatContextScopes: scopes,
    articleChatContextScopePayload: () => ({ sectionIds: ['methods'],
      sectionTitles: ['Hidden Methods'], scopes: Array.from(scopes.values()) }),
    currentWorkspaceSnapshot: { chat: { turns: [], totalTurns: 0, loading: false } },
    capturePanelContext: () => ({ tabId: 7 }),
    isCurrentPanelContext: () => true,
    sendTabMessage: async (tabId, message) => {
      sent.push({ tabId, message });
      return reply(message);
    },
    showStatus: (message, type) => statuses.push({ message, type }),
    articleChatFailureText: error => error?.message || String(error),
    closeArticleChatCommandMenu() { sandbox.chatMenuClosed = true; },
    renderArticleChatContextScopes() { sandbox.chatScopesRendered = true; },
    applyArticleChatStateEvent: event => events.push(event)
  };
  vm.runInNewContext([
    functionSource('getArticleChatProfiles'),
    functionSource('preflightArticleChatContextScope'),
    functionSource('submitArticleSemanticHighlight')
  ].join('\n'), sandbox);
  return { sandbox, elements, sent, statuses, scopes, events };
}
function renderControls(f) {
  vm.runInNewContext(functionSource('renderArticleSemanticHighlightControls'), f.sandbox);
  f.sandbox.renderArticleSemanticHighlightControls();
}

test('highlight submits the visible independent query and model with no hidden chat scope', async () => {
  const f = fixture();
  await f.sandbox.submitArticleSemanticHighlight({ preventDefault() {} });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].tabId, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(f.sent[0].message)), {
    action: 'highlightArticleMatchesWithLLM', question: 'find independent evidence',
    profileId: 'search-profile', categoryId: 'semantic_match', categoryName: 'Match',
    highlightColor: '#118844', contextScope: { sectionIds: [], sectionTitles: [], scopes: [] }
  });
  assert.equal(f.elements.articleSemanticHighlightQuery.value, '');
  assert.equal(f.elements.articleChatQuestion.value, 'private chat draft');
  assert.equal(f.elements.articleChatProfile.value, 'chat-profile');
  assert.equal(f.scopes.size, 1);
  assert.equal(f.sandbox.chatMenuClosed, undefined);
  assert.equal(f.sandbox.chatScopesRendered, undefined);
});

test('empty independent query focuses its own input without submitting the hidden chat draft', async () => {
  const f = fixture();
  f.elements.articleSemanticHighlightQuery.value = '  ';
  await f.sandbox.submitArticleSemanticHighlight();
  assert.equal(f.sent.length, 0);
  assert.equal(f.elements.articleSemanticHighlightQuery.focused, true);
  assert.equal(f.elements.articleChatQuestion.value, 'private chat draft');
});

test('a missing independent model cannot silently use the chat model', async () => {
  const f = fixture();
  f.elements.articleSemanticHighlightProfile.value = '';
  await f.sandbox.submitArticleSemanticHighlight();
  assert.equal(f.sent.length, 0);
  assert.equal(f.statuses.at(-1).type, 'error');
  assert.equal(f.elements.articleSemanticHighlightQuery.value, 'find independent evidence');
});

test('missing consent prevents semantic requests without consuming either draft', async () => {
  const f = fixture();
  f.sandbox.llmSettingsState.settings.consentGranted = false;
  await f.sandbox.submitArticleSemanticHighlight();
  assert.equal(f.sent.length, 0);
  assert.equal(f.elements.articleSemanticHighlightQuery.value, 'find independent evidence');
  assert.equal(f.elements.articleChatQuestion.value, 'private chat draft');
});

test('failed semantic request restores only its independent submitted draft', async () => {
  const f = fixture({ reply: async () => ({ success: false, error: 'local failure' }) });
  await f.sandbox.submitArticleSemanticHighlight();
  assert.equal(f.sent[0].message.question, 'find independent evidence');
  assert.equal(f.elements.articleSemanticHighlightQuery.value, 'find independent evidence');
  assert.equal(f.elements.articleChatQuestion.value, 'private chat draft');
  assert.equal(f.scopes.size, 1);
  assert.equal(f.statuses.at(-1).type, 'error');
});

test('delayed failure preserves newer independent typing and never rewrites chat', async () => {
  let reject;
  const f = fixture({ reply: () => new Promise((_, fail) => { reject = fail; }) });
  const pending = f.sandbox.submitArticleSemanticHighlight();
  assert.equal(f.elements.articleSemanticHighlightQuery.value, '');
  f.elements.articleSemanticHighlightQuery.value = 'newer search draft';
  f.elements.articleChatQuestion.value = 'newer chat draft';
  reject(new Error('local failure'));
  await pending;
  assert.equal(f.elements.articleSemanticHighlightQuery.value, 'newer search draft');
  assert.equal(f.elements.articleChatQuestion.value, 'newer chat draft');
  assert.equal(f.scopes.size, 1);
});

test('delayed success retains newer independent typing and publishes returned turn once', async () => {
  let resolve;
  const f = fixture({ reply: () => new Promise(done => { resolve = done; }) });
  const pending = f.sandbox.submitArticleSemanticHighlight();
  f.elements.articleSemanticHighlightQuery.value = 'newer search draft';
  resolve({ success: true, turn: { turnId: 'semantic-1', mode: 'semantic_highlight' } });
  await pending;
  assert.equal(f.elements.articleSemanticHighlightQuery.value, 'newer search draft');
  assert.equal(f.elements.articleChatQuestion.value, 'private chat draft');
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].turn.turnId, 'semantic-1');
  assert.equal(f.scopes.size, 1);
});

test('stale panel responses cannot restore input or publish a turn into a new document', async () => {
  let resolve;
  const f = fixture({ reply: () => new Promise(done => { resolve = done; }) });
  const pending = f.sandbox.submitArticleSemanticHighlight();
  f.sandbox.isCurrentPanelContext = () => false;
  resolve({ success: true, turn: { turnId: 'old-document-turn' } });
  await pending;
  assert.equal(f.events.length, 0);
  assert.equal(f.statuses.length, 0);
});

test('independent model renderer preserves visible choice and query across refreshes', () => {
  const f = fixture();
  renderControls(f);
  assert.equal(f.elements.articleSemanticHighlightProfile.value, 'search-profile');
  assert.deepEqual(f.elements.articleSemanticHighlightProfile.children.map(x => x.value),
    ['chat-profile', 'search-profile']);
  assert.equal(f.elements.articleSemanticHighlightQuery.value, 'find independent evidence');
  assert.equal(f.sandbox.articleChatSelectedProfileId, 'chat-profile');
  f.sandbox.renderArticleSemanticHighlightControls();
  assert.equal(f.elements.articleSemanticHighlightProfile.value, 'search-profile');
});

test('independent model renderer visibly falls back when its profile disappears', () => {
  const f = fixture();
  delete f.sandbox.llmSettingsState.settings.profiles['search-profile'];
  f.sandbox.llmSettingsState.settings.profileOrder = ['chat-profile'];
  renderControls(f);
  assert.equal(f.elements.articleSemanticHighlightProfile.value, 'chat-profile');
  assert.equal(f.elements.highlightArticleChatMatches.disabled, false);
  assert.equal(f.elements.articleSemanticHighlightQuery.value, 'find independent evidence');
});

test('independent model renderer disables search without a usable profile or category', () => {
  const f = fixture();
  f.sandbox.llmSettingsState.settings.profiles = {};
  f.sandbox.llmSettingsState.settings.profileOrder = [];
  renderControls(f);
  assert.equal(f.elements.articleSemanticHighlightProfile.disabled, true);
  assert.equal(f.elements.articleSemanticHighlightProfile.value, '');
  assert.equal(f.elements.highlightArticleChatMatches.disabled, true);
  assert.match(f.elements.articleSemanticHighlightProfile.children[0].textContent, /尚未配置/);
  const available = fixture();
  available.elements.articleChatHighlightCategory.value = '';
  renderControls(available);
  assert.equal(available.elements.highlightArticleChatMatches.disabled, true);
});

test('snapshot rendering and independent profile changes keep the semantic controls synchronized', () => {
  const snapshot = functionSource('renderArticleChatSnapshot');
  assert.match(snapshot, /renderArticleSemanticHighlightControls\(\)/);
  assert.doesNotMatch(snapshot, /highlight\.disabled\s*=\s*!articleChatSelectedProfileId/);
  assert.match(source, /getElementById\('articleSemanticHighlightProfile'\)\?\.addEventListener\(\s*'change',\s*renderArticleSemanticHighlightControls/);
});
