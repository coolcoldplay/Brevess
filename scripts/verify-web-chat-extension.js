// Isolated real-extension acceptance. Provider traffic is fulfilled locally with
// synthetic Responses/SSE fixtures; this script never uses a real API key.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.join(__dirname, '..'));
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR || path.join(root, 'output/playwright/web-chat'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-web-chat-profile-'));
const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-web-chat-extension-'));
const articleUrl = 'https://example.org/brevess-web-chat-acceptance';
const sourceUrl = 'https://journals.example.org/article?id=7';
const title = 'BREVESS web chat acceptance';
const answer = 'Synthetic external evidence supports the bounded claim.';
const unverifiedAnswer = 'Synthetic complete web answer is retained without verified citations.';
const multiMessageAnswer = 'Synthetic final multi-message answer is retained as the complete answer.';
const plainAnswer = 'Synthetic ordinary answer from the article.';
const report = {
  provider: 'synthetic loopback fixtures only',
  realApiCalls: 0,
  realServiceSuccessClaimed: false,
  checks: [], requests: [], sourceHashes: {}
};
let context;
let panel;
let release;
let mode = 'valid';
let server;
let serverUrl;

function stage(value) { process.stdout.write(`${value}\n`); }
function check(name, value) { assert.ok(value, name); report.checks.push(name); stage(`PASS ${name}`); }
function prepare() {
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
  }
  for (const file of ['content.js', 'popup.js', 'popup.css', 'core/article-chat-web-sources.js',
    'core/article-archive.js', 'core/background-router.js', 'providers/deepseek.js']) {
    report.sourceHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex');
  }
  // Playwright routes cannot intercept this extension's dedicated offscreen
  // Worker. Replace only that temporary copy's final fetch boundary, before the
  // worker loads; the provider, transport, router, storage and UI stay unchanged.
  const networkFile = path.join(extension, 'offscreen-network-worker.js');
  const boundary = `const qaNativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, options) => {
  const parsed = new URL(String(url));
  if (parsed.origin !== 'https://api.deepseek.com' ||
      !['/responses', '/chat/completions'].includes(parsed.pathname)) {
    throw new Error('QA_BLOCKED_REMOTE_FETCH');
  }
  return qaNativeFetch(${JSON.stringify(serverUrl)} + parsed.pathname, options);
};\n`;
  fs.writeFileSync(networkFile, boundary + fs.readFileSync(networkFile, 'utf8'));
  report.testInjection = 'Temporary offscreen worker fetch boundary -> loopback HTTP fixture; no production edits';
}
function fixture() {
  return `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${articleUrl}">
    <meta name="citation_doi" content="10.1000/brevess-web-chat"></head><body><main><article><h1>${title}</h1>
    <section><h2>Abstract</h2><p>The precise mechanism remains unclear. This study aimed to summarize a defined molecular pathway and its translational implications across experimental systems.</p></section>
    <section><h2>Introduction</h2><p>It is well established that metabolic signaling regulates immune adaptation through coordinated transcriptional and epigenetic programs in disease.</p></section>
    <section><h2>Results</h2><p>We performed a matched-control experiment. We found that activation of kinase A increased transcription factor B, which directly induced target C and promoted cellular survival.</p><p>Genetic inhibition of kinase A abolished target C induction, supporting a necessary mechanistic relationship.</p></section>
    <section><h2>Limitations</h2><p>One major limitation of this study is that available evidence used small preclinical cohorts and requires validation in independent human samples.</p></section>
    <section><h2>Conclusions</h2><p>In conclusion, our findings support a testable pathway while leaving its clinical generalizability unresolved.</p></section>
    </article></main></body></html>`;
}
function completeAnswerText(marker) {
  return [
    { type: 'answer_block', block_id: `${marker}-summary`, markdown: `## 摘要\n${marker === 'trusted' ? answer : marker === 'multi' ? multiMessageAnswer : unverifiedAnswer}` },
    { type: 'answer_block', block_id: `${marker}-results`, markdown: '## 结果\n文章描述 kinase A 增加 transcription factor B，并诱导 target C。' },
    { type: 'answer_block', block_id: `${marker}-limits`, markdown: '## 局限\n现有证据来自小型临床前队列，仍需独立人类样本验证。' },
    { type: 'answer_block', block_id: `${marker}-conclusion`, markdown: '## 结论\n现有材料支持限定机制链，但临床外推性尚未解决。' },
    { type: 'final', status: 'completed' }
  ].map(value => JSON.stringify(value)).join('\n');
}
function response(kind) {
  const marker = kind === 'valid' ? 'trusted' : kind === 'multi-unverified' ? 'multi' : 'unverified';
  const structuredText = completeAnswerText(marker);
  const text = kind === 'malformed'
    ? '{"type":"answer_block","block_id":"broken"'
    : kind === 'multi-unverified'
      ? `检索说明：已完成外部检索，下面给出结构化回答。\n检索说明：仅最终答案块应进入论文问答。\n${structuredText}`
      : structuredText;
  const start = text.indexOf('external evidence');
  const output = [
    { id: 'ws_fixture', type: 'web_search_call', status: 'completed', action: { type: 'search', queries: ['synthetic query'] } }
  ];
  if (kind === 'multi-unverified') {
    output.push({
      id: 'msg_process_fixture', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Search process completed; preparing the final structured answer.', annotations: [] }]
    });
  }
  output.push({
    id: 'msg_answer_fixture', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: kind === 'valid' ? [{
      type: 'url_citation', start_index: start,
      end_index: start + 'external evidence'.length,
      url: sourceUrl, title: 'Synthetic primary evidence'
    }] : [] }]
  });
  return {
    id: `resp_fixture_${report.requests.length}`,
    status: kind === 'truncated' ? 'incomplete' : 'completed',
    ...(kind === 'truncated' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    ...(kind === 'multi-unverified' ? {} : { output_text: text }),
    output,
    usage: { input_tokens: 41, output_tokens: 19 }
  };
}
async function setupProfile() {
  return panel.evaluate(async () => {
    for (const message of [
      { type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_qa_web', name: 'QA DeepSeek synthetic', providerId: 'deepseek',
        config: { apiKey: 'fixture-not-a-real-key', model: 'deepseek-v4-flash', maxOutputTokens: 4096, reasoningEnabled: false } } },
      { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_qa_web', taskRoutes: {} },
      { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
    ]) {
      const result = await chrome.runtime.sendMessage(message);
      if (!result?.success) throw new Error(`SETUP_FAILED:${JSON.stringify(result?.error)}`);
    }
    await loadLlmSettings();
    await refreshArticleWorkspace();
    switchWorkspaceView('chat');
    const select = document.getElementById('articleChatProfile');
    select.value = 'profile_qa_web';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function archive() {
  return panel.evaluate(async () => (await getCurrentArticleArchiveFromTab()).archive);
}
async function waitTurns(predicate, description) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try {
      const value = await archive();
      if (predicate(value.workspace?.chat?.turns || [])) return value;
    } catch (error) {
      // A committed import reinitializes the isolated content world. The panel
      // deliberately reports not-ready until the new world's identity is proven.
      if (!/ARTICLE_ARCHIVE_DOCUMENT_NOT_READY/.test(error.message)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`TIMEOUT ${description}`);
}
async function submit(question) {
  await panel.locator('#articleChatQuestion').fill(question);
  await panel.locator('#sendArticleChat').click();
}
async function enableWebSearch() {
  const toggle = panel.locator('#articleChatWebSearch');
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
}
async function downloadArchive() {
  const downloadPromise = panel.waitForEvent('download');
  await panel.locator('#exportCurrentArticleArchive').click();
  const download = await downloadPromise;
  return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  server = http.createServer(async (request, reply) => {
    reply.setHeader('Access-Control-Allow-Origin', '*');
    reply.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') { reply.writeHead(204); reply.end(); return; }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    report.requests.push({
      sequence: report.requests.length + 1,
      fixtureMode: mode,
      path: request.url,
      webSearch: body.tools?.[0]?.type === 'web_search',
      stream: body.stream
    });
    if (mode === 'hold') await new Promise(resolve => { release = resolve; });
    if (request.url === '/responses') {
      reply.setHeader('Content-Type', 'application/json');
      reply.end(JSON.stringify(response(mode)));
      return;
    }
    const text = `${JSON.stringify({ type: 'answer_block', block_id: 'answer-1', markdown: plainAnswer })}\n${JSON.stringify({ type: 'final', status: 'completed' })}`;
    const chunks = [
      { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 31, completion_tokens: 12 } }
    ];
    reply.setHeader('Content-Type', 'text/event-stream');
    reply.end(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}`;
  prepare();
  context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  // Route page-level traffic; the offscreen worker is separately isolated above.
  await context.route(/^https?:\/\//, async route => {
    const request = route.request();
    const url = request.url();
    if (url === articleUrl) return route.fulfill({ contentType: 'text/html', body: fixture() });
    if (url === sourceUrl) return route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic primary evidence</h1>' });
    if (url.startsWith(serverUrl + '/')) return route.continue();
    return route.abort('blockedbyclient');
  });
  const paper = context.pages()[0] || await context.newPage();
  await paper.goto(articleUrl);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(item => item.url === url), articleUrl);
  assert.ok(tab?.id, 'article tab found');
  await worker.evaluate(async activeTab => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, activeTab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  }, tab);
  panel = await context.newPage();
  await panel.setViewportSize({ width: 460, height: 960 });
  await panel.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(expected => document.getElementById('sidePanelPaperTitle')?.textContent === expected, title);
  await setupProfile();
  check('web toggle defaults off', await panel.locator('#articleChatWebSearch').getAttribute('aria-pressed') === 'false');
  await enableWebSearch();
  mode = 'hold';
  await submit('Synthetic QA: find external evidence for this claim.');
  await panel.waitForFunction(() => document.querySelectorAll('.article-chat-turn').length === 1);
  const requestDeadline = Date.now() + 15000;
  while (!release && Date.now() < requestDeadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(release, 'synthetic Responses request intercepted');
  check('in-flight toggle is locked to the submitted turn', await panel.locator('#articleChatWebSearch').isDisabled());
  check('unverified in-flight web answer stays hidden', await panel.locator('.article-chat-answer-block').count() === 0);
  mode = 'valid'; release(); release = null;
  const firstArchive = await waitTurns(turns => turns[0]?.status === 'completed', 'completed web turn');
  const first = firstArchive.workspace.chat.turns[0];
  check('captured per-turn web toggle and durable receipt', first.webSearch?.enabled === true && !!first.webGrounding?.receiptId);
  check('trusted citation path keeps complete structured answer and no unverified marker',
    (first.answerBlocks || []).length === 4 &&
    (first.answerBlocks || []).some(block => block.markdown.includes(answer)) &&
    !first.answerProvenance && first.webSearch?.searched === true);
  await panel.locator('.article-chat-web-source-dot').first().waitFor();
  const link = panel.locator('.article-chat-web-source-dot').first();
  check('numbered safe original source', await link.getAttribute('href') === sourceUrl && await link.textContent() === '1' && (await link.getAttribute('rel')).includes('noopener'));
  const opened = context.waitForEvent('page');
  await link.click();
  const source = await opened;
  await source.waitForURL(sourceUrl);
  check('source dot opens original URL', source.url() === sourceUrl);
  await source.close();
  await paper.bringToFront();
  await panel.screenshot({ path: path.join(output, 'web-source.png'), fullPage: true });

  await panel.reload({ waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(expected => document.getElementById('sidePanelPaperTitle')?.textContent === expected, title);
  await setupProfile();
  await panel.locator('.article-chat-web-source-dot').first().waitFor();
  check('panel reload retains source and answer', (await panel.locator('.article-chat-turn').first().textContent()).includes(answer));

  await submit('Synthetic QA: explain only the article.');
  const plainArchive = await waitTurns(turns => turns.length === 2 && turns[1]?.status === 'completed', 'ordinary turn');
  check('web-off uses chat stream without web sources', plainArchive.workspace.chat.turns[1].webSearch?.enabled !== true && !plainArchive.workspace.chat.turns[1].webGrounding && report.requests[1]?.path === '/chat/completions');
  mode = 'unverified';
  await enableWebSearch();
  await submit('Synthetic QA: complete web answer without verifiable citations.');
  const unverifiedArchive = await waitTurns(turns =>
    turns.length === 3 && turns[2]?.status === 'completed',
  'completed provider-unverified turn');
  const unverified = unverifiedArchive.workspace.chat.turns[2];
  check('missing citations retain the complete structured answer',
    (unverified.answerBlocks || []).length === 4 &&
    (unverified.answerBlocks || []).some(block => block.markdown.includes(unverifiedAnswer)));
  check('missing citations use explicit provider-unverified provenance',
    unverified.answerProvenance?.origin === 'provider_unverified' &&
    unverified.answerProvenance?.verification === 'unverified');
  check('unverified web turn keeps intent but records no verified search',
    unverified.webSearch?.enabled === true && unverified.webSearch?.searched === false &&
    !unverified.webGrounding);
  const thirdTurn = panel.locator('.article-chat-turn').nth(2);
  await thirdTurn.waitFor();
  check('unverified provider answer is visibly labeled',
    /联网回答\s*·\s*来源未验证|web answer\s*·\s*source unverified/i
      .test(await thirdTurn.innerText()));
  check('unverified provider answer exposes no trusted source control',
    await thirdTurn.locator('.article-chat-web-source-dot').count() === 0);
  await panel.screenshot({ path: path.join(output, 'provider-unverified.png'), fullPage: true });

  const unverifiedExport = await downloadArchive();
  const exportedUnverified = unverifiedExport.workspace.chat.turns[2];
  check('actual JSON export preserves provider-unverified marker',
    exportedUnverified.answerProvenance?.origin === 'provider_unverified' &&
    exportedUnverified.answerProvenance?.verification === 'unverified' &&
    exportedUnverified.webSearch?.searched === false && !exportedUnverified.webGrounding);

  await panel.reload({ waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(expected =>
    document.getElementById('sidePanelPaperTitle')?.textContent === expected, title);
  await setupProfile();
  const reloadedUnverified = panel.locator('.article-chat-turn').nth(2);
  await reloadedUnverified.waitFor();
  check('reload retains provider-unverified answer and marker',
    (await reloadedUnverified.innerText()).includes(unverifiedAnswer) &&
    /来源未验证|source unverified/i.test(await reloadedUnverified.innerText()) &&
    await reloadedUnverified.locator('.article-chat-web-source-dot').count() === 0);

  mode = 'multi-unverified';
  await enableWebSearch();
  await submit('Synthetic QA: choose the final answer from multiple completed messages.');
  const multiArchive = await waitTurns(turns =>
    turns.length === 4 && turns[3]?.status === 'completed',
  'completed multi-message provider-unverified turn');
  const multi = multiArchive.workspace.chat.turns[3];
  check('multi-message response strips prose prefixes and retains final NDJSON answer',
    (multi.answerBlocks || []).length === 4 &&
    (multi.answerBlocks || []).some(block => block.markdown.includes(multiMessageAnswer)) &&
    !(multi.answerBlocks || []).some(block =>
      /Search process completed|检索说明：/u.test(block.markdown)) &&
    !/Search process completed|检索说明：/u.test(
      await panel.locator('.article-chat-turn').nth(3).innerText()
    ));
  check('multi-message response is unverified without trusted citations',
    multi.answerProvenance?.origin === 'provider_unverified' &&
    multi.answerProvenance?.verification === 'unverified' &&
    multi.webSearch?.searched === false && !multi.webGrounding &&
    await panel.locator('.article-chat-turn').nth(3)
      .locator('.article-chat-web-source-dot').count() === 0);

  mode = 'malformed';
  await enableWebSearch();
  await submit('Synthetic QA: malformed provider response remains rejected.');
  const malformed = await waitTurns(turns =>
    turns.length === 5 && ['failed', 'error', 'incomplete', 'truncated'].includes(turns[4]?.status),
  'failed malformed turn');
  check('malformed web response still fails without readable answer',
    !(malformed.workspace.chat.turns[4].answerBlocks || []).length &&
    !malformed.workspace.chat.turns[4].answerProvenance &&
    !malformed.workspace.chat.turns[4].webGrounding);

  mode = 'truncated';
  await enableWebSearch();
  await submit('Synthetic QA: truncated provider response remains rejected.');
  const truncated = await waitTurns(turns =>
    turns.length === 6 && ['failed', 'error', 'incomplete', 'truncated'].includes(turns[5]?.status),
  'failed truncated turn');
  check('truncated web response still fails without readable answer',
    !(truncated.workspace.chat.turns[5].answerBlocks || []).length &&
    !truncated.workspace.chat.turns[5].answerProvenance &&
    !truncated.workspace.chat.turns[5].webGrounding);

  // Exercise the actual file input. No receipt: retained readable answer must
  // acquire an unverified external-origin label and lose its trusted source links.
  const imported = structuredClone(firstArchive);
  delete imported.workspace.chat.turns[0].webGrounding;
  await panel.locator('#importCurrentArticleArchive').setInputFiles({ name: 'external.sci-archive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await waitTurns(turns => turns.some(turn => turn.answerProvenance?.origin === 'external_import'), 'external import');
  const importedText = await panel.locator('.article-chat-turn').first().textContent();
  check('file import retains answer and displays unverified source label', importedText.includes(answer) && /来源未验证|source unverified/i.test(importedText));
  check('unbound imported answer has no trusted source dots', await panel.locator('.article-chat-web-source-dot').count() === 0);
  await panel.screenshot({ path: path.join(output, 'external-import-unverified.png'), fullPage: true });
  const exported = await archive();
  check('re-export preserves external provenance',
    exported.workspace.chat.turns[0].answerProvenance?.origin === 'external_import' &&
    exported.workspace.chat.turns[0].answerProvenance?.verification === 'unverified');
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(expected => document.getElementById('sidePanelPaperTitle')?.textContent === expected, title);
  await setupProfile();
  await panel.waitForFunction(() => /来源未验证|source unverified/i.test(document.querySelector('.article-chat-turn')?.textContent || ''));
  check('reload preserves imported answer and label', (await panel.locator('.article-chat-turn').first().textContent()).includes(answer));
  const requestsByMode = Object.fromEntries([...new Set(report.requests.map(item => item.fixtureMode))]
    .map(fixtureMode => [fixtureMode,
      report.requests.filter(item => item.fixtureMode === fixtureMode).length]));
  report.requestCount = report.requests.length;
  report.requestsByMode = requestsByMode;
  check('all provider traffic used the expected loopback endpoints',
    report.requests.length >= 6 && report.requests.every(item =>
      item.path === '/responses' || item.path === '/chat/completions'));
  report.passed = true;
})().catch(async error => {
  report.passed = false;
  report.error = error.message;
  if (panel) {
    report.identityState = await panel.evaluate(() => ({ identity: currentArticleArchiveIdentity(),
      prepared: preparedDocumentState, manual: manualAnnotationState,
      workspace: { documentId: currentWorkspaceSnapshot?.documentId, documentHash: currentWorkspaceSnapshot?.documentHash,
        url: currentWorkspaceSnapshot?.url, localWorkspace: currentWorkspaceSnapshot?.localWorkspace }
    })).catch(() => ({}));
    report.visibleState = await panel.locator('body').innerText().catch(() => 'unavailable');
    await panel.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
}).finally(async () => {
  release?.();
  await context?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  report.requestCount = report.requests.length;
  report.requestsByMode ||= Object.fromEntries([
    ...new Set(report.requests.map(item => item.fixtureMode))
  ].map(fixtureMode => [fixtureMode,
    report.requests.filter(item => item.fixtureMode === fixtureMode).length]));
  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  stage(JSON.stringify({ passed: report.passed, checks: report.checks.length, requests: report.requests.length, error: report.error, output }));
  // Profiles remain only in the named OS temporary directories for debugging.
});
