const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const verificationPath = path.join(root, 'scripts',
  'verify-sidebar-notice-markdown-extension.mjs');
const verification = fs.readFileSync(verificationPath, 'utf8');

test('sidebar notice and Markdown browser verifier is an ESM entry point', () => {
  assert.match(verification, /(?:^|\n)import assert from 'node:assert\/strict';/u);
  assert.match(verification, /await run\(\);\s*$/u);
});

test('browser verifier loads the current real popup in an isolated extension', () => {
  assert.match(verification, /fs\.copyFileSync\(path\.join\(root, file\)/);
  assert.match(verification, /chrome-extension:\/\/\$\{extensionId\}\/popup\.html/);
  assert.match(verification, /report\.sourceHashes\[relativePath\] = sourceHash/);
  assert.match(verification, /context\.route\(\/\^https\?:/);
  assert.match(verification, /realApiCalls === 0/);
});

test('browser verifier covers abbreviation dialog continuity and exact source identity', () => {
  assert.match(verification, /renderArticleAbbreviationTable\(/);
  assert.match(verification, /dialogOpen/);
  assert.match(verification, /editedValue/);
  assert.match(verification, /scrollTop/);
  assert.match(verification, /paragraphId === 'paragraph-1'/);
  assert.match(verification, /sourceKey === 'source-1'/);
});

test('browser verifier covers operation notice identity, dismissal, and every requested terminal state', () => {
  assert.match(verification, /renderArticleWorkspaceSaveProgress\(/);
  assert.match(verification, /renderMechanismGenerationStatus\(/);
  assert.match(verification, /same operation repaint stays dismissed/);
  assert.match(verification, /new save operation is visible/);
  assert.match(verification, /save success, warning, and failure terminal notices auto-dismiss/);
  assert.match(verification, /mechanism completion terminal notice auto-dismisses/);
  assert.match(verification, /new mechanism operation is visible and failure auto-dismisses/);
});

test('browser verifier covers shared Markdown links, tables, navigation, and source buttons', () => {
  assert.match(verification, /createPanelFollowupControl\(/);
  assert.match(verification, /renderArticleChatMarkdown\(/);
  assert.match(verification, /\*\*Current finding\*\*/);
  assert.match(verification, /\*\*Historical finding\*\*/);
  assert.match(verification, /https:\/\/doi\.org\/10\.1002\/\(SICI\)/);
  assert.match(verification, /http:\/\/www\.who\.int/);
  assert.match(verification, /<https:\/\/pubmed\.ncbi\.nlm\.nih\.gov/);
  assert.match(verification, /javascript:alert\(1\)/);
  assert.match(verification, /127\.0\.0\.1\/secret/);
  assert.match(verification, /user:pass@www\.nature\.com/);
  assert.match(verification, /file:\/\/\/etc\/passwd/);
  assert.match(verification, /<img onerror=alert\(1\)>/);
  assert.match(verification, /preservedScientificInline/);
  assert.match(verification, /preservedCode/);
  assert.match(verification, /rawHtmlInert/);
  assert.match(verification, /article-chat-markdown-table/);
  assert.match(verification, /context\.waitForEvent\('page'/);
  assert.match(verification, /blockedNetworkRequests\.includes\(targetUrl\)/);
  assert.match(verification, /workspace-panel-followup-source/);
  assert.match(verification, /sourceButtons\.forEach\(button => button\.click\(\)\)/);
});

test('production Markdown renderer keeps display links separate from strict grounding', () => {
  const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  const markdownStart = popup.indexOf('function normalizeArticleChatMarkdownLinkUrl');
  const markdownEnd = popup.indexOf('function isUnsafeArticleChatWebHostname', markdownStart);
  const markdown = popup.slice(markdownStart, markdownEnd);
  assert.match(markdown, /\['http:', 'https:'\]\.includes\(parsed\.protocol\)/);
  assert.match(markdown, /parsed\.username\s*\|\|\s*parsed\.password/);
  assert.match(markdown, /isUnsafeArticleChatWebHostname\(parsed\.hostname\)/);
  assert.match(markdown, /dataset\.sourceTrust\s*=\s*'unverified'/);
  assert.match(markdown, /target\s*=\s*'_blank'/);
  assert.match(markdown, /rel\s*=\s*'noopener noreferrer'/);
  assert.match(markdown, /referrerPolicy\s*=\s*'no-referrer'/);
  assert.doesNotMatch(markdown, /normalizeArticleChatWebSource\(/);
});

test('production Markdown renderer parses tables without raw HTML', () => {
  const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  const markdownStart = popup.indexOf('function normalizeArticleChatMarkdownLinkUrl');
  const markdownEnd = popup.indexOf('function isUnsafeArticleChatWebHostname', markdownStart);
  const markdown = popup.slice(markdownStart, markdownEnd);
  assert.match(markdown, /function parseArticleChatMarkdownTableRow/);
  assert.match(markdown, /function articleChatMarkdownTableAlignments/);
  assert.match(markdown, /function createArticleChatMarkdownTable/);
  assert.match(markdown, /document\.createElement\('thead'\)/);
  assert.match(markdown, /document\.createElement\('tbody'\)/);
  assert.doesNotMatch(markdown, /innerHTML|insertAdjacentHTML|outerHTML/);
});
