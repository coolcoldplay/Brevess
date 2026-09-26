const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const verificationPath = path.join(root, 'scripts',
  'verify-local-library-integrated-extension.mjs');
const verification = fs.readFileSync(verificationPath, 'utf8');

test('integrated local-library verifier is a configurable ESM entry point', () => {
  assert.match(verification, /SCI_EXTENSION_ROOT/u);
  assert.match(verification, /SCI_QA_OUTPUT_DIR/u);
  assert.match(verification, /await run\(\);\s*$/u);
});

test('verifier copies and hashes the complete current production extension', () => {
  assert.match(verification, /fs\.cpSync\(path\.join\(root, directory\)/u);
  assert.match(verification, /fs\.copyFileSync\(path\.join\(root, file\)/u);
  assert.match(verification, /'background\.js'/u);
  assert.match(verification, /'options\.html'/u);
  assert.match(verification, /'options-local-library\.js'/u);
  assert.doesNotMatch(verification, /background-fixture|fixture\.memory/u);
});

test('verifier seeds real workspace and abbreviation RPC without a replacement background', () => {
  assert.match(verification, /ARTICLE_WORKSPACE_ENSURE/u);
  assert.match(verification, /ARTICLE_WORKSPACE_SAVE_ASSET/u);
  assert.match(verification, /ABBREVIATION_MEMORY_MERGE/u);
  assert.match(verification, /LOCAL_READING_LIBRARY_QUERY/u);
  assert.match(verification, /ABBREVIATION_MEMORY_MUTATE/u);
  assert.match(verification, /chrome\.runtime\.sendMessage/u);
  assert.match(verification, /article\/paragraphs\.json/u);
  assert.match(verification, /annotations\/literature-note\.json/u);
  assert.match(verification, /figures\/inventory\.json/u);
});

test('verifier covers all search scopes, occurrence boundaries, and CRUD', () => {
  for (const scope of ['title', 'notes', 'fulltext', 'abstract', 'method', 'caption']) {
    assert.match(verification, new RegExp(`${scope}: '${scope === 'title'
      ? 'Inflammation Atlas' : `${scope}-only-marker`}'`, 'u'));
  }
  assert.match(verification, /expectedTnfOccurrences/u);
  assert.match(verification, /xTNF/u);
  assert.match(verification, /TNF1/u);
  assert.match(verification, /UI create persists/u);
  assert.match(verification, /editing full name preserves stable entry identity/u);
  assert.match(verification, /UI visibility toggle/u);
  assert.match(verification, /UI delete removes/u);
});

test('verifier proves real persistence across page and browser-worker restart', () => {
  assert.match(verification, /verifySameBrowserPageReopen/u);
  assert.match(verification, /browser-and-worker-restart/u);
  assert.match(verification, /launchPersistentContext\(profile/u);
  assert.match(verification, /composeArticleAbbreviations/u);
  assert.match(verification, /hiddenFromReading/u);
  assert.match(verification, /firstImportedAt/u);
});

test('verifier is isolated from user profile and the network and emits evidence', () => {
  assert.match(verification, /mkdtempSync/u);
  assert.match(verification, /launched\.route\(\/\^https\?:/u);
  assert.match(verification, /realApiCalls === 0/u);
  assert.match(verification, /local-library-integrated\.png/u);
  assert.match(verification, /report\.json/u);
  assert.match(verification, /sci-logic-highlighter-user-data/u);
  assert.match(verification, /sciGlobalAbbreviationMemoryV1/u);
});
