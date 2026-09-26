// QA017/018 isolated real-extension acceptance; adapted from verify-web-chat-extension.js. Provider traffic is fulfilled locally with
// synthetic Responses/SSE fixtures; this script never uses a real API key.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.join(__dirname, '..'));
const outputBase = path.resolve(process.env.SCI_QA_OUTPUT_DIR ||
  path.join(__dirname, '../output/playwright/qa017-018-web'));
fs.mkdirSync(outputBase, { recursive: true });
const output = fs.mkdtempSync(path.join(outputBase, 'run-'));
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
  extensionSourceRoot: root,
  provider: 'synthetic loopback fixtures only',
  realApiCalls: 0,
  realServiceSuccessClaimed: false,
  screenshotPolicy: 'Playwright finishes transient animations for stable captures; production CSS unchanged',
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
    'core/article-archive.js', 'core/background-router.js', 'core/article-chat.js', 'providers/deepseek.js', 'providers/openai.js']) {
    report.sourceHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex');
  }
  // Playwright routes cannot intercept this extension's dedicated offscreen
  // Worker. Replace only that temporary copy's final fetch boundary, before the
  // worker loads; the provider, transport, router, storage and UI stay unchanged.
  const networkFile = path.join(extension, 'offscreen-network-worker.js');
  const boundary = `const qaNativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, options) => {
  const parsed = new URL(String(url));
  if (parsed.origin !== 'https://api.openai.com' ||
      !['/v1/responses', '/v1/chat/completions'].includes(parsed.pathname)) {
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
      { type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_qa_web', name: 'QA OpenAI synthetic', providerId: 'openai',
        config: { apiKey: 'fixture-not-a-real-key', model: 'gpt-5-mini', maxOutputTokens: 4096, reasoningEnabled: false } } },
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
    if (request.url === '/v1/responses') {
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
  await panel.locator('.article-chat-web-source-dot').first().scrollIntoViewIfNeeded();
  await panel.screenshot({ path: path.join(output, 'web-source.png'), fullPage: true, animations: 'disabled' });

  await panel.reload({ waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(expected => document.getElementById('sidePanelPaperTitle')?.textContent === expected, title);
  await setupProfile();
  await panel.locator('.article-chat-web-source-dot').first().waitFor();
  check('panel reload retains source and answer', (await panel.locator('.article-chat-turn').first().textContent()).includes(answer));


  mode = 'unverified';
  await enableWebSearch();
  await submit('Synthetic QA017: reject an answer with missing source metadata.');
  const failedArchive = await waitTurns(turns => turns.length === 2 && turns[1]?.status === 'error', 'missing-source failure');
  const failed = failedArchive.workspace.chat.turns[1];
  check('missing sources produce exact error without an unverified answer',
    failed.errorCode === 'WEB_SEARCH_GROUNDING_MISSING' && !(failed.answerBlocks || []).length &&
    !failed.webGrounding && !failed.answerProvenance);
  const failedTurn = panel.locator('.article-chat-turn').nth(1);
  check('source failure has an enabled regenerate action',
    await failedTurn.locator('[data-article-chat-action="regenerate"]').isEnabled());
  await failedTurn.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: path.join(output, 'missing-sources.png'), fullPage: true, animations: 'disabled' });
  const beforeRetryCount = report.requests.length;
  mode = 'valid';
  await failedTurn.locator('[data-article-chat-action="regenerate"]').click();
  const retried = await waitTurns(turns => turns.length === 2 && turns[1]?.status === 'completed', 'retry completes same turn');
  const retriedTurn = retried.workspace.chat.turns[1];
  check('regenerate binds the real source to the same failed turn',
    retriedTurn.turnId === failed.turnId && !!retriedTurn.webGrounding?.receiptId &&
    retriedTurn.webGrounding.binding.turnId === failed.turnId &&
    retriedTurn.webGrounding.binding.operationId !== first.webGrounding.binding.operationId);
  check('retry performs one new request and preserves prior answer',
    report.requests.length === beforeRetryCount + 1 && retried.workspace.chat.turns[0].turnId === first.turnId &&
    retried.workspace.chat.turns[0].answer === first.answer);
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(expected => document.getElementById('sidePanelPaperTitle')?.textContent === expected, title);
  await setupProfile();
  await panel.waitForFunction(() => document.querySelectorAll('.article-chat-web-source-dot').length === 2);
  check('reload retains both complete answers and source links', (await archive()).workspace.chat.turns.length === 2);
  await panel.locator('.article-chat-web-source-dot').last().scrollIntoViewIfNeeded();
  await panel.screenshot({ path: path.join(output, 'retry-reloaded.png'), fullPage: true, animations: 'disabled' });

  await panel.evaluate(async () => {
    const saved = await chrome.runtime.sendMessage({ type: 'LLM_SAVE_PROFILE', profile: {
      id: 'profile_qa_deepseek', name: 'QA unsupported DeepSeek', providerId: 'deepseek',
      config: { apiKey: 'fixture-not-a-real-key', model: 'deepseek-flash', maxOutputTokens: 4096 }
    } });
    if (!saved?.success) throw Error('DEEPSEEK_FIXTURE_SETUP_FAILED');
    await loadLlmSettings();
    renderArticleChatSnapshot(currentWorkspaceSnapshot);
  });
  await panel.locator('#articleChatProfile').selectOption('profile_qa_deepseek');
  check('new DeepSeek fixture profile is visibly selected before submission',
    await panel.locator('#articleChatProfile').inputValue() === 'profile_qa_deepseek');
  await enableWebSearch();
  const beforeUnsupported = report.requests.length;
  await submit('Synthetic QA018: unsupported official DeepSeek must not issue a request.');
  const unsupported = await waitTurns(turns => turns.length === 3 && turns[2]?.status === 'error', 'unsupported provider');
  check('official DeepSeek reports unsupported without a network call',
    unsupported.workspace.chat.turns[2].errorCode === 'WEB_SEARCH_UNSUPPORTED' &&
    report.requests.length === beforeUnsupported);
  check('unsupported turn leaves previous receipts unchanged',
    unsupported.workspace.chat.turns[0].webGrounding.receiptId === first.webGrounding.receiptId &&
    unsupported.workspace.chat.turns[1].webGrounding.receiptId === retriedTurn.webGrounding.receiptId);
  await panel.locator('.article-chat-turn').last().scrollIntoViewIfNeeded();
  await panel.screenshot({ path: path.join(output, 'unsupported-deepseek.png'), fullPage: true, animations: 'disabled' });
  check('all local provider requests targeted only the supported web endpoint',
    report.requests.length === 3 && report.requests.every(item => item.path === '/v1/responses' && item.webSearch));
  check('owned production files stayed unchanged during browser verification',
    ['core/article-chat-web-sources.js', 'core/article-chat.js', 'providers/deepseek.js', 'providers/openai.js']
      .every(file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') === report.sourceHashes[file]));
  report.passed = true;
})().catch(async error => {
  report.passed = false; report.error = error.message; process.exitCode = 1;
  if (panel) {
    report.visibleState = await panel.locator('body').innerText().catch(() => 'unavailable');
    report.turnDiagnostics = await archive().then(value => (value.workspace?.chat?.turns || [])
      .map(turn => ({ turnId: turn.turnId, status: turn.status, errorCode: turn.errorCode, error: turn.error }))).catch(() => []);
    await panel.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  }
}).finally(async () => {
  release?.(); await context?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  report.requestCount = report.requests.length;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  stage(JSON.stringify({ passed: report.passed, checks: report.checks.length,
    requests: report.requests.length, error: report.error, output }));
});
