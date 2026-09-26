// Real-browser acceptance for the J semantic-find UI. Fixture mode exercises the
// complete production UI/message/provider path while a loopback server returns
// deterministic TypeSafe-compatible noul decisions. Real TypeSafe calls are
// explicit, bounded, and keep the real credential only in this Node process.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const OFFICIAL_ORIGIN = 'https://api.typesafe.ai';
const DECISION_PATH = '/v1/systemone';
const MODEL = 'jev-1.13.0';
const DUMMY_SECRET = 'semantic-find-loopback-dummy';
const DEFAULT_CALL_CAP = 10;
const DEFAULT_FIXTURE_CALL_CAP = 32;
const DEFAULT_PDF = path.join(repositoryRoot, 'tmp', 'public-pdf-acceptance',
  'elife-83176-v2.pdf');
const EXPECTED_PDF_SHA256 =
  '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';
const TEMP_PREFIX = 'brevess-semantic-find-';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const UI_TIMEOUT_MS = 120_000;

const SOURCE_SENTENCES = Object.freeze({
  question: 'The study asks whether compound Q improves signal recovery in cultured astrocytes.',
  method: 'We quantified signal recovery with blinded imaging and a preregistered analysis.',
  positiveEnglish: 'Compound Q clearly increased signal recovery by 28 percent compared with vehicle.',
  positiveChinese: '作者明确报告处理组的信号恢复增加，而载体对照保持稳定。',
  secondPositive: 'A second experiment showed a robust recovery gain after compound Q treatment.',
  negative: 'Compound Q did not increase signal recovery in the confirmatory cohort.',
  existingAi: 'The preregistered assay was retained as an existing automatic highlight control.',
  existingManual: 'This sentence is retained as an existing manual highlight control.',
  purposeExperiment: 'To test this alternative hypothesis, we designed a MERFISH experiment that maps the predicted cellular response.',
  boundary: 'These fixture sentences test software behavior and are not a scientific benchmark.'
});

function codedError(code, detail = '') {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

function safeCode(error) {
  const code = String(error?.code || error?.message || 'SEMANTIC_FIND_ACCEPTANCE_FAILED')
    .split(':', 1)[0];
  return /^[A-Z][A-Z0-9_]{2,100}$/u.test(code)
    ? code : 'SEMANTIC_FIND_ACCEPTANCE_FAILED';
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filename) {
  return sha256(fs.readFileSync(filename));
}

function helpText() {
  return [
    'Usage: node scripts/verify-semantic-find.mjs [options]',
    '  --api-mode fixture|real-api   Default fixture; fixture makes zero real provider calls.',
    '  --browser msedge|chrome      Installed browser channel (default msedge).',
    '  --extension-root PATH         Unpacked extension source (default repository root).',
    '  --pdf PATH                    Public source PDF (default eLife 83176 v2, 23 pages).',
    '  --output-dir PATH             New artifact directory; existing paths are rejected.',
    '  --call-cap N                  Real API: 1-10 (default 10); fixture: 1-32 (default 32).',
    '  --headed                      Show the isolated browser window.',
    '  --diagnose-manual             Instrument only the temporary copy with safe manual lifecycle receipts.',
    '  --diagnose-injection          Instrument only the temporary copy with safe injection lifecycle receipts.',
    '  --html-only                   Skip the PDF browser stage.',
    '  --pdf-only                    Skip the HTML browser stage.',
    '',
    'real-api prompts on a hidden TTY and forwards through a localhost credential boundary.',
    'The credential remains in Node memory and is never written to the profile or report.'
  ].join('\n');
}

function parseArguments(argv) {
  const options = {};
  const booleans = new Set(['--headed', '--diagnose-manual', '--diagnose-injection',
    '--html-only', '--pdf-only', '--help']);
  const valued = new Set(['--api-mode', '--browser', '--extension-root', '--pdf', '--output-dir', '--call-cap']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleans.has(flag)) {
      options[flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = true;
      continue;
    }
    if (!valued.has(flag)) throw codedError('SEMANTIC_FIND_ARGUMENT_INVALID', flag);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw codedError('SEMANTIC_FIND_ARGUMENT_INVALID', flag);
    }
    options[flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return options;
}

function normalizeOptions(argv = [], environment = {}) {
  const args = parseArguments(argv);
  const browser = String(args.browser || environment.browser || 'msedge');
  if (!['msedge', 'chrome'].includes(browser)) throw codedError('SEMANTIC_FIND_BROWSER_INVALID');
  const apiMode = String(args.apiMode || environment.apiMode || 'fixture');
  if (!['fixture', 'real-api'].includes(apiMode)) {
    throw codedError('SEMANTIC_FIND_API_MODE_INVALID');
  }
  const maximumCallCap = apiMode === 'real-api' ? DEFAULT_CALL_CAP : DEFAULT_FIXTURE_CALL_CAP;
  const callCap = Number(args.callCap || environment.callCap || maximumCallCap);
  if (!Number.isSafeInteger(callCap) || callCap < 1 || callCap > maximumCallCap) {
    throw codedError('SEMANTIC_FIND_CALL_CAP_INVALID');
  }
  if (args.htmlOnly && args.pdfOnly) throw codedError('SEMANTIC_FIND_STAGE_SELECTION_INVALID');
  const outputDirectory = path.resolve(args.outputDir || environment.outputDirectory || path.join(
    repositoryRoot, 'output', 'playwright',
    `semantic-find-${timestampSlug()}-${crypto.randomBytes(3).toString('hex')}`
  ));
  return Object.freeze({
    browser,
    apiMode,
    callCap,
    extensionRoot: path.resolve(args.extensionRoot || environment.extensionRoot || repositoryRoot),
    pdfPath: path.resolve(args.pdf || environment.pdfPath || DEFAULT_PDF),
    outputDirectory,
    headed: args.headed === true || environment.headed === true,
    diagnoseManual: args.diagnoseManual === true || environment.diagnoseManual === true,
    diagnoseInjection: args.diagnoseInjection === true || environment.diagnoseInjection === true,
    html: !args.pdfOnly && environment.html !== false,
    pdf: !args.htmlOnly && environment.pdf !== false,
    help: args.help === true
  });
}

function fixtureHtml() {
  const paragraph = (id, text) => `<p id="${id}"><span>${text.slice(0, Math.ceil(text.length / 2))}</span>${text.slice(Math.ceil(text.length / 2))}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <title>Semantic find deterministic browser fixture</title>
  <meta name="citation_title" content="Semantic find deterministic browser fixture">
  <meta name="citation_doi" content="10.0000/brevess.semantic.find.fixture">
  <link rel="icon" href="data:,">
  <style>body{font:18px/1.65 Arial,sans-serif;margin:32px;color:#15202b}article{max-width:900px;margin:auto}p{margin:18px 0}</style>
  </head><body><main><article><h1>Semantic find deterministic browser fixture</h1>
  <section><h2>Introduction</h2>${paragraph('question', SOURCE_SENTENCES.question)}</section>
  <section><h2>Methods</h2>${paragraph('method', SOURCE_SENTENCES.method)}</section>
  <section><h2>Results</h2>${paragraph('existing-ai', SOURCE_SENTENCES.existingAi)}${paragraph('positive-en', SOURCE_SENTENCES.positiveEnglish)}${paragraph('positive-zh', SOURCE_SENTENCES.positiveChinese)}${paragraph('positive-two', SOURCE_SENTENCES.secondPositive)}${paragraph('negative', SOURCE_SENTENCES.negative)}${paragraph('purpose-experiment', SOURCE_SENTENCES.purposeExperiment)}</section>
  <section><h2>Discussion</h2>${paragraph('existing-manual', SOURCE_SENTENCES.existingManual)}${paragraph('boundary', SOURCE_SENTENCES.boundary)}</section>
  </article></main></body></html>`;
}

function normalizedWords(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function scoreFixtureSentence(query, sentence) {
  const q = normalizedWords(query);
  const text = normalizedWords(sentence);
  if ((/(?:increase|gain|improv|recovery)/u.test(q) || /(?:增加|恢复|改善)/u.test(q))) {
    if (/did not increase/u.test(text)) return 0.04;
    if (/clearly increased signal recovery/u.test(text)) return 0.96;
    if (/信号恢复增加/u.test(text)) return 0.92;
    if (/robust recovery gain/u.test(text)) return 0.84;
    if (/asks whether/u.test(text)) return 0.42;
    if (/quantified signal recovery/u.test(text)) return 0.26;
  }
  if (/(?:microgl|neuron|motility|activity|小胶质|神经活动)/u.test(q)) {
    const terms = [/(?:microgl|小胶质)/u, /(?:motility|迁移|movement)/u,
      /(?:neuron|activity|神经|活动)/u];
    const count = terms.filter(term => term.test(text)).length;
    if (count >= 2) return 0.94;
    if (count === 1) return 0.73;
  }
  if (/(?:为了.+目的.+实验|设计.+实验|experiment.+purpose|test.+hypothesis)/u.test(q)) {
    if (/to test this alternative hypothesis.+designed a merfish experiment/u.test(text)) return 0.97;
    if (/experiment/u.test(text)) return 0.36;
  }
  const digest = crypto.createHash('sha256').update(`${q}\0${text}`).digest();
  return Number((0.05 + (digest[0] / 255) * 0.14).toFixed(3));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateSemanticFindRequest(body) {
  if (!isRecord(body) || body.model !== MODEL || !isRecord(body.state) ||
      body.state.phase !== 'semantic_find' || body.state.version !== 'semantic-find-v1' ||
      typeof body.state.query !== 'string' || !body.state.query.trim() ||
      !isRecord(body.state.sentences) || !isRecord(body.questions)) {
    throw codedError('SEMANTIC_FIND_FIXTURE_REQUEST_INVALID');
  }
  const sentenceIds = Object.keys(body.state.sentences);
  const questionIds = Object.keys(body.questions);
  if (!sentenceIds.length || sentenceIds.length !== questionIds.length ||
      sentenceIds.some((id, index) => id !== questionIds[index])) {
    throw codedError('SEMANTIC_FIND_FIXTURE_KEYS_INVALID');
  }
  for (const id of sentenceIds) {
    const sentence = body.state.sentences[id];
    const question = body.questions[id];
    if (!isRecord(sentence) || typeof sentence.paragraph_id !== 'string' ||
        !Number.isSafeInteger(sentence.start) || sentence.start < 0 ||
        !Number.isSafeInteger(sentence.end) || sentence.end <= sentence.start ||
        !Number.isSafeInteger(sentence.occurrence) || sentence.occurrence < 0 ||
        typeof sentence.text !== 'string' || !sentence.text ||
        !isRecord(question) || question.type !== 'noul' ||
        typeof question.instructions !== 'string' || !question.instructions) {
      throw codedError('SEMANTIC_FIND_FIXTURE_ITEM_INVALID');
    }
  }
  return { query: body.state.query, sentenceIds, sentences: body.state.sentences };
}

function buildFixtureDecision(body) {
  const valid = validateSemanticFindRequest(body);
  return {
    model: MODEL,
    answers: Object.fromEntries(valid.sentenceIds.map(id => [id, {
      type: 'noul', noul: scoreFixtureSentence(valid.query, valid.sentences[id].text)
    }]))
  };
}

function assertExactDecision(body, response) {
  const valid = validateSemanticFindRequest(body);
  if (!isRecord(response) || !isRecord(response.answers) ||
      Object.keys(response.answers).length !== valid.sentenceIds.length ||
      valid.sentenceIds.some(id => !Object.hasOwn(response.answers, id))) {
    throw codedError('SEMANTIC_FIND_PROVIDER_KEYS_INVALID');
  }
  for (const id of valid.sentenceIds) {
    const answer = response.answers[id];
    if (!isRecord(answer) || answer.type !== 'noul' ||
        typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) ||
        answer.noul < 0 || answer.noul > 1) {
      throw codedError('SEMANTIC_FIND_PROVIDER_SCORE_INVALID');
    }
  }
  return true;
}

function redactDiagnostic(value, secret = '') {
  let text = String(value || '');
  if (secret) text = text.replaceAll(secret, '[redacted-secret]');
  return text
    .replace(/Bearer\s+\S+/giu, '[redacted-authorization]')
    .replace(/https?:\/\/\S+/giu, '[redacted-location]')
    .replace(/[A-Za-z]:\\[^\s"']+/gu, '[redacted-location]')
    .slice(0, 600);
}

function assertSafeReport(report, secret = '') {
  const forbiddenKeys = /^(?:apiKey|authorization|credential|providerBody|requestBody|rawText|paragraphs|sentences|questions|answers)$/iu;
  const visit = (value, key = '') => {
    if (forbiddenKeys.test(key)) throw codedError('SEMANTIC_FIND_REPORT_FORBIDDEN_KEY', key);
    if (typeof value === 'string') {
      if ((secret && value.includes(secret)) || /Bearer\s+\S+|sk-[A-Za-z0-9_-]{10,}/iu.test(value)) {
        throw codedError('SEMANTIC_FIND_REPORT_SECRET_LEAK');
      }
      return;
    }
    if (Array.isArray(value)) return value.forEach(item => visit(item));
    if (isRecord(value)) Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(report);
  return true;
}

function writeReport(filename, report, secret = '') {
  assertSafeReport(report, secret);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function createOutputDirectory(directory) {
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  if (fs.existsSync(directory)) throw codedError('SEMANTIC_FIND_OUTPUT_EXISTS');
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw codedError('SEMANTIC_FIND_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

async function startServer({ mode, getSecret, callCap, report, persist, assetRoot }) {
  const html = fixtureHtml();
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204); response.end(); return;
    }
    if (request.method === 'GET' && request.url === '/fixture/article.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html); return;
    }
    if (request.method === 'GET' && request.url === '/fixture/vendor/phosphor/Phosphor.woff2') {
      const font = path.join(assetRoot, 'vendor', 'phosphor', 'Phosphor.woff2');
      if (!fs.existsSync(font)) {
        response.writeHead(404); response.end(); return;
      }
      response.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'no-store' });
      response.end(fs.readFileSync(font)); return;
    }
    let receipt = null;
    let rejectedShape = { method: String(request.method || ''), path: String(request.url || '') };
    try {
      const remote = String(request.socket.remoteAddress || '');
      assert.ok(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote),
        'SEMANTIC_FIND_PROXY_REMOTE_REJECTED');
      assert.equal(request.method, 'POST', 'SEMANTIC_FIND_PROXY_METHOD_REJECTED');
      assert.equal(request.url, DECISION_PATH, 'SEMANTIC_FIND_PROXY_PATH_REJECTED');
      assert.equal(request.headers.authorization, `Bearer ${DUMMY_SECRET}`,
        'SEMANTIC_FIND_PROXY_AUTH_REJECTED');
      if (report.provider.calls.length >= callCap) {
        report.provider.capRejected = true; persist();
        response.writeHead(429, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'SEMANTIC_FIND_CALL_CAP' } }));
        return;
      }
      const bytes = await readBody(request);
      const body = JSON.parse(bytes.toString('utf8'));
      rejectedShape = {
        ...rejectedShape,
        model: String(body?.model || '').slice(0, 80),
        phase: String(body?.state?.phase || '').slice(0, 80),
        questionCount: isRecord(body?.questions) ? Object.keys(body.questions).length : 0,
        questionTypes: isRecord(body?.questions)
          ? [...new Set(Object.values(body.questions).map(item => String(item?.type || '')))].slice(0, 8)
          : []
      };
      const valid = validateSemanticFindRequest(body);
      receipt = {
        sequence: report.provider.calls.length + 1,
        mode,
        sentenceCount: valid.sentenceIds.length,
        querySha256: sha256(valid.query),
        requestSha256: sha256(bytes),
        responseSha256: '',
        scores: [],
        status: 0,
        elapsedMs: 0
      };
      report.provider.calls.push(receipt); persist();
      const started = Date.now();
      let status = 200;
      let reply;
      if (mode === 'fixture') {
        if (/late|迟到|cancel/u.test(valid.query)) {
          await new Promise(resolve => setTimeout(resolve, 1800));
        }
        reply = buildFixtureDecision(body);
      } else {
        const upstream = await fetch(`${OFFICIAL_ORIGIN}${DECISION_PATH}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${getSecret()}`, 'content-type': 'application/json' },
          body: bytes,
          signal: AbortSignal.timeout(120_000)
        });
        status = upstream.status;
        const upstreamBytes = Buffer.from(await upstream.arrayBuffer());
        if (upstreamBytes.length > MAX_BODY_BYTES) throw codedError('SEMANTIC_FIND_REPLY_TOO_LARGE');
        reply = JSON.parse(upstreamBytes.toString('utf8'));
        if (status >= 200 && status < 300) assertExactDecision(body, reply);
      }
      const replyText = JSON.stringify(reply);
      receipt.status = status;
      receipt.elapsedMs = Date.now() - started;
      receipt.responseSha256 = sha256(replyText);
      if (status >= 200 && status < 300) {
        receipt.scores = Object.values(reply.answers).map(answer => answer.noul);
        receipt.decisions = valid.sentenceIds.map(id => ({
          id,
          paragraphId: valid.sentences[id].paragraph_id,
          textSha256: sha256(valid.sentences[id].text),
          score: reply.answers[id].noul
        }));
      }
      report.provider.realCalls += mode === 'real-api' ? 1 : 0;
      persist();
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(replyText);
    } catch (error) {
      if (receipt) receipt.errorCode = safeCode(error);
      report.diagnostics.proxyErrors.push({ code: safeCode(error), ...rejectedShape }); persist();
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: safeCode(error) } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function copyExtension(source, destination, port, options = {}) {
  fs.mkdirSync(destination, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales', 'cmaps', 'standard_fonts']) {
    const from = path.join(source, directory);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(destination, directory), { recursive: true });
  }
  for (const file of fs.readdirSync(source)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(source, file), path.join(destination, file));
    }
  }
  fs.writeFileSync(path.join(destination, 'semantic-find-acceptance-rpc.html'),
    '<!doctype html><meta charset="utf-8"><title>Semantic find acceptance RPC</title>', 'utf8');
  const workerFile = path.join(destination, 'offscreen-network-worker.js');
  const boundary = `const __semanticFindNativeFetch = globalThis.fetch.bind(globalThis);\n` +
    `globalThis.fetch = (input, init = {}) => {\n` +
    `  const parsed = new URL(typeof input === 'string' ? input : input.url);\n` +
    `  if (parsed.origin !== ${JSON.stringify(OFFICIAL_ORIGIN)} || parsed.pathname !== ${JSON.stringify(DECISION_PATH)} || parsed.search || parsed.hash) throw new Error('SEMANTIC_FIND_REMOTE_FETCH_BLOCKED');\n` +
    `  return __semanticFindNativeFetch('http://127.0.0.1:${port}${DECISION_PATH}', init);\n` +
    `};\n`;
  fs.writeFileSync(workerFile, boundary + fs.readFileSync(workerFile, 'utf8'), 'utf8');
  if (options.diagnoseManual === true) {
    const contentFile = path.join(destination, 'content.js');
    let content = fs.readFileSync(contentFile, 'utf8');
    const diagnostic = event => `(globalThis.__semanticFindManualDiagnostic ||= []).push({` +
      `event:${JSON.stringify(event)},sequence:Number(manualPrepareSequence)||0,` +
      `workspaceLifecycle:Number(articleWorkspaceLifecycleGeneration)||0,` +
      `annotationCount:Number(currentManualDocument?.record?.annotations?.length)||0,` +
      `markCount:document.querySelectorAll('.sci-manual-highlight,.pdf-native-annotation-hit').length,` +
      `stack:String(new Error().stack||'').split('\\n').slice(1,7).map(line=>line.replace(/chrome-extension:\\/\\/[^/]+\\//u,'extension/'))});`;
    for (const name of ['clearManualHighlightMarks', 'freezeManualDocumentInteraction',
      'prepareManualDocumentFresh', 'prepareManualDocument']) {
      const pattern = new RegExp(`((?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{)`, 'u');
      if (!pattern.test(content)) throw codedError('SEMANTIC_FIND_DIAGNOSTIC_PATCH_MISSING', name);
      content = content.replace(pattern, `$1\n    ${diagnostic(name)}`);
    }
    fs.writeFileSync(contentFile, content, 'utf8');
  }
  if (options.diagnoseInjection === true) {
    const backgroundFile = path.join(destination, 'background.js');
    let background = fs.readFileSync(backgroundFile, 'utf8');
    const prelude = `globalThis.__semanticFindInjectionDiagnostic=[];\n` +
      `globalThis.__semanticFindTrace=(event,data={})=>{const rows=globalThis.__semanticFindInjectionDiagnostic;rows.push({at:Date.now(),context:'background',event,...data});if(rows.length>200)rows.shift();};\n`;
    background = prelude + background;
    background = background.replace(
      'chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {',
      `chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {\n  globalThis.__semanticFindTrace('onUpdated',{tabId,status:String(changeInfo?.status||''),hasUrl:Boolean(changeInfo?.url),tabStatus:String(tab?.status||''),generation:Number(tabSidePanelNavigationGenerations.get(tabId)||0)});`
    );
    background = background.replace(
      'async function syncActivatedTabAfterUpdate(tabId, generation, tab, { warm = false } = {}) {',
      `async function syncActivatedTabAfterUpdate(tabId, generation, tab, { warm = false } = {}) {\n  globalThis.__semanticFindTrace('sync-start',{tabId,generation,warm,currentGeneration:Number(tabSidePanelNavigationGenerations.get(tabId)||0)});`
    );
    fs.writeFileSync(backgroundFile, background, 'utf8');

    fs.writeFileSync(path.join(destination, 'semantic-find-injection-trace.js'),
      `globalThis.__semanticFindInjectionDiagnostic=[];\n` +
      `globalThis.__semanticFindTrace=(event,data={})=>{const rows=globalThis.__semanticFindInjectionDiagnostic;rows.push({at:Date.now(),context:'popup',event,...data});if(rows.length>200)rows.shift();};\n`, 'utf8');
    const popupFile = path.join(destination, 'popup.html');
    let popup = fs.readFileSync(popupFile, 'utf8');
    const messengerTag = '<script src="core/tab-messenger.js"></script>';
    if (!popup.includes(messengerTag)) {
      throw codedError('SEMANTIC_FIND_DIAGNOSTIC_PATCH_MISSING', 'popup tab-messenger');
    }
    popup = popup.replace(messengerTag,
      `<script src="semantic-find-injection-trace.js"></script>\n    ${messengerTag}`);
    fs.writeFileSync(popupFile, popup, 'utf8');

    const messengerFile = path.join(destination, 'core', 'tab-messenger.js');
    let messenger = fs.readFileSync(messengerFile, 'utf8');
    messenger = messenger.replace(
      'function ensureContentScript(chromeApi, tabId, options = {}) {',
      `function ensureContentScript(chromeApi, tabId, options = {}) {\n    globalThis.__semanticFindTrace?.('ensure-start',{tabId,contextKey:String(options?.contextKey||''),epoch:recoveryEpoch(tabId),hasRecovery:recoveryByTab.has(tabId)});`
    );
    messenger = messenger.replace(
      'const state = await inspectContentInjection(chromeApi, target, true, binding);\n' +
      '      await assertMessageCurrent(chromeApi, tabId, guardedOptions);',
      'const state = await inspectContentInjection(chromeApi, target, true, binding);\n' +
      `      globalThis.__semanticFindTrace?.('claim-state',{tabId,state,contextKey:String(options?.contextKey||''),epoch});\n` +
      '      await assertMessageCurrent(chromeApi, tabId, guardedOptions);'
    );
    messenger = messenger.replace(
      'await chromeApi.scripting.executeScript({ target, files: CONTENT_SCRIPT_FILES });',
      `globalThis.__semanticFindTrace?.('execute-before',{tabId,contextKey:String(options?.contextKey||''),epoch});\n` +
      `        const __semanticFindExecuteResults=await chromeApi.scripting.executeScript({ target, files: CONTENT_SCRIPT_FILES });\n` +
      `        const __semanticFindPageIdentity=await chromeApi.scripting.executeScript({target,func:()=>({url:String(location.href),revision:String(document.documentElement?.dataset?.sciLlmContentRevision||''),identity:typeof contentDocumentIdentity==='string'?contentDocumentIdentity:''})});\n` +
      `        globalThis.__semanticFindTrace?.('execute-after',{tabId,contextKey:String(options?.contextKey||''),epoch,documents:(__semanticFindExecuteResults||[]).map(item=>({frameId:item.frameId,documentId:String(item.documentId||'')})),pageIdentity:__semanticFindPageIdentity?.[0]?.result||null});`
    );
    messenger = messenger.replace(
      'function forgetContentScriptState(tabId) {',
      `function forgetContentScriptState(tabId) {\n    globalThis.__semanticFindTrace?.('forget',{tabId,epoch:recoveryEpoch(tabId),hasRecovery:recoveryByTab.has(tabId)});`
    );
    fs.writeFileSync(messengerFile, messenger, 'utf8');
  }
}

function removeTemporary(directory) {
  const resolved = path.resolve(directory);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${temporaryRoot}${path.sep}`) ||
      !path.basename(resolved).startsWith(TEMP_PREFIX)) {
    throw codedError('SEMANTIC_FIND_TEMP_CONTAINMENT_FAILED');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function deriveRealApiPdf(source, destination, pageNumbers = [1, 2]) {
  if (!Array.isArray(pageNumbers) || !pageNumbers.length ||
      pageNumbers.some(number => !Number.isSafeInteger(number) || number < 1)) {
    throw codedError('SEMANTIC_FIND_DERIVED_PDF_PAGES_INVALID');
  }
  const program = [
    'import sys',
    'from pypdf import PdfReader, PdfWriter',
    'source, target, page_csv = sys.argv[1:4]',
    'reader = PdfReader(source)',
    'pages = [int(value) for value in page_csv.split(",")]',
    'assert pages and all(1 <= value <= len(reader.pages) for value in pages)',
    'writer = PdfWriter()',
    'for value in pages: writer.add_page(reader.pages[value - 1])',
    'with open(target, "wb") as stream: writer.write(stream)'
  ].join('\n');
  const result = spawnSync('python', ['-c', program, source, destination,
    pageNumbers.join(',')], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.status !== 0 || !fs.existsSync(destination) || fs.statSync(destination).size < 1000) {
    throw codedError('SEMANTIC_FIND_DERIVED_PDF_FAILED',
      redactDiagnostic(result.stderr || result.error?.message || 'python pypdf failed'));
  }
  return { path: destination, pageNumbers: [...pageNumbers], sha256: sha256File(destination) };
}

async function closeServer(server) {
  if (!server) return;
  server.closeIdleConnections?.();
  await Promise.race([
    new Promise(resolve => server.close(resolve)),
    new Promise(resolve => setTimeout(() => { server.closeAllConnections?.(); resolve(); }, 5000))
  ]);
}

async function configureProfile(rpcPage) {
  return rpcPage.evaluate(async ({ dummy, model }) => {
    const send = async payload => {
      const response = await chrome.runtime.sendMessage(payload);
      if (response?.success !== true) throw new Error(response?.error?.code || 'RPC_FAILED');
      return response.data;
    };
    const initial = await send({ type: 'LLM_GET_SETTINGS' });
    const profileId = 'profile_semantic_find_acceptance';
    await send({ type: 'LLM_SAVE_PROFILE', profile: {
      id: profileId, name: 'Semantic find acceptance', providerId: 'typesafe',
      config: { apiKey: dummy, model }
    } });
    await send({ type: 'LLM_UPDATE_PROFILE_ROUTING',
      globalProfileId: initial.settings.globalProfileId,
      taskPolicies: { ...initial.settings.taskPolicies,
        semantic_find: { mode: 'profile', profileId } } });
    await send({ type: 'LLM_UPDATE_PREFERENCES', preferences: {
      mode: 'regex', consentGranted: true
    } });
    const finalState = await send({ type: 'LLM_GET_SETTINGS' });
    return {
      profileStored: Boolean(finalState.settings.profiles?.[profileId]),
      routeProfileId: finalState.settings.taskPolicies?.semantic_find?.profileId || '',
      credentialMasked: finalState.settings.profiles?.[profileId]?.config?.hasApiKey === true &&
        !Object.hasOwn(finalState.settings.profiles?.[profileId]?.config || {}, 'apiKey')
    };
  }, { dummy: DUMMY_SECRET, model: MODEL });
}

async function existingTabId(worker, url) {
  return worker.evaluate(async expectedUrl => {
    const tab = (await chrome.tabs.query({})).find(item => item.url === expectedUrl);
    if (!Number.isSafeInteger(tab?.id)) throw new Error('SEMANTIC_FIND_TAB_MISSING');
    return tab.id;
  }, url);
}

async function contentMessage(worker, tabId, message) {
  return worker.evaluate(async ({ tabId: id, message: payload }) => {
    try { return await chrome.tabs.sendMessage(id, payload); }
    catch (error) { return { success: false, error: String(error?.message || error) }; }
  }, { tabId, message });
}

function attachDiagnostics(context, report) {
  const note = (bucket, value) => {
    report.diagnostics[bucket].push(redactDiagnostic(value));
    if (report.diagnostics[bucket].length > 30) report.diagnostics[bucket].shift();
  };
  context.on('page', page => {
    page.on('pageerror', error => note('pageErrors', error?.message || error));
    page.on('console', message => {
      if (message.type() === 'error') note('consoleErrors', message.text());
    });
  });
  return note;
}

async function collectInjectionDiagnostics(context, worker) {
  const background = worker ? await worker.evaluate(() =>
    structuredClone(globalThis.__semanticFindInjectionDiagnostic || [])).catch(() => []) : [];
  const extensionPages = [];
  for (const page of context?.pages?.() || []) {
    if (!page.url().startsWith('chrome-extension://')) continue;
    const events = await page.evaluate(() =>
      structuredClone(globalThis.__semanticFindInjectionDiagnostic || [])).catch(() => []);
    if (events.length) extensionPages.push({ path: new URL(page.url()).pathname, events });
  }
  return { background, extensionPages };
}

async function waitForSemanticUi(page) {
  await page.locator('.sci-semantic-find:not([hidden])').waitFor({ state: 'visible', timeout: 30_000 });
  const roles = ['query', 'submit', 'previous', 'next', 'close', 'settings',
    'threshold-range', 'threshold-number', 'status', 'position', 'progress', 'score', 'legend'];
  for (const role of roles) {
    await page.locator(`[data-semantic-find-role="${role}"]`).waitFor({ state: 'attached' });
  }
}

async function openWithJ(page) {
  await page.bringToFront();
  await page.keyboard.press('j');
  await waitForSemanticUi(page);
  const input = page.locator('[data-semantic-find-role="query"]');
  await input.fill('editable');
  await input.press('j');
  assert.equal(await input.inputValue(), 'editablej', 'SEMANTIC_FIND_EDITABLE_J_INTERCEPTED');
  return input;
}

async function inspectPdfHits(page, expectedMinimum = 1) {
  const hits = page.locator('.pdf-native-semantic-search-hit');
  await page.waitForFunction(minimum =>
    document.querySelectorAll('.pdf-native-semantic-search-hit').length >= minimum,
  expectedMinimum, { timeout: UI_TIMEOUT_MS });
  const values = await hits.evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      id: node.dataset.semanticFindId || '',
      score: Number(node.dataset.score),
      current: node.dataset.current === 'true',
      background: style.backgroundColor,
      top: rect.top + scrollY,
      left: rect.left + scrollX,
      width: rect.width,
      height: rect.height
    };
  }));
  assert.ok(values.length >= expectedMinimum, 'SEMANTIC_FIND_HITS_EMPTY');
  assert.ok(values.every(item => item.id && Number.isFinite(item.score) &&
    item.score >= 0 && item.score <= 1 && item.width > 0 && item.height > 0),
  'SEMANTIC_FIND_HIT_CONTRACT_INVALID');
  const groups = new Map();
  for (const item of values) {
    if (!groups.has(item.id)) groups.set(item.id, []);
    groups.get(item.id).push(item);
  }
  const logicalHits = [...groups.entries()].map(([id, rects]) => {
    assert.equal(new Set(rects.map(item => item.score)).size, 1,
      'SEMANTIC_FIND_PDF_SCORE_INCONSISTENT');
    assert.equal(new Set(rects.map(item => item.current)).size, 1,
      'SEMANTIC_FIND_PDF_CURRENT_INCONSISTENT');
    return { id, score: rects[0].score, current: rects[0].current,
      background: rects[0].background, rectCount: rects.length };
  });
  assert.ok(logicalHits.length >= expectedMinimum, 'SEMANTIC_FIND_LOGICAL_HITS_EMPTY');
  assert.equal(logicalHits.filter(item => item.current).length, 1,
    'SEMANTIC_FIND_CURRENT_HIT_INVALID');
  assertScoreVisualIntensity(logicalHits,
    'SEMANTIC_FIND_SCORE_INTENSITY_NOT_MONOTONIC');
  return logicalHits;
}

function cssColorAlpha(background) {
  return Number(String(background || '').match(
    /rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/u)?.[1] ?? 1);
}

function assertScoreVisualIntensity(items, failureCode) {
  const byScore = items.slice().sort((left, right) => left.score - right.score);
  assert.ok(byScore.length > 0, failureCode);
  for (const item of byScore) {
    const actual = cssColorAlpha(item.background);
    const expected = 0.12 + (item.score * 0.78);
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 0.005,
      `${failureCode}:${item.score}:${item.background}`);
  }
  for (let index = 1; index < byScore.length; index += 1) {
    if (byScore[index].score === byScore[index - 1].score) continue;
    assert.ok(cssColorAlpha(byScore[index].background) >
      cssColorAlpha(byScore[index - 1].background), failureCode);
  }
  return true;
}

async function semanticReadout(page) {
  const positionText = await page.locator('[data-semantic-find-role="position"]').innerText();
  const scoreText = await page.locator('[data-semantic-find-role="score"]').innerText();
  const position = positionText.match(/(\d+)\s*\/\s*(\d+)/u);
  const score = scoreText.match(/([01](?:\.\d+)?)/u);
  return {
    current: Number(position?.[1] || 0),
    total: Number(position?.[2] || 0),
    score: score ? Number(score[1]) : null,
    positionText,
    scoreText
  };
}

async function inspectHtmlHighlights(page, expectedMinimum = 1) {
  await page.waitForFunction(minimum => {
    const position = document.querySelector('[data-semantic-find-role="position"]')?.textContent || '';
    const total = Number(position.match(/\/\s*(\d+)/u)?.[1] || 0);
    const current = CSS.highlights?.get('sci-semantic-search-current');
    return total >= minimum && current?.size > 0;
  }, expectedMinimum, { timeout: UI_TIMEOUT_MS });
  const snapshot = await page.evaluate(() => {
    const rangeEvidence = range => {
      const element = range.startContainer?.nodeType === Node.ELEMENT_NODE
        ? range.startContainer : range.startContainer?.parentElement;
      return {
        paragraphId: element?.closest?.('[id]')?.id || '',
        text: range.toString()
      };
    };
    const colorByName = new Map();
    for (const sheet of document.styleSheets) {
      let rules = [];
      try { rules = [...sheet.cssRules]; } catch (_) { continue; }
      for (const rule of rules) {
        const match = String(rule.selectorText || '').match(
          /^::highlight\((sci-semantic-search-\d+)\)$/u);
        if (match) colorByName.set(match[1], rule.style.backgroundColor || '');
      }
    }
    const buckets = [];
    for (let index = 0; index <= 100; index += 1) {
      const name = `sci-semantic-search-${index}`;
      const entry = CSS.highlights?.get(name);
      if (entry?.size) buckets.push({ name, score: index / 100, rangeCount: entry.size,
        background: colorByName.get(name) || '', ranges: Array.from(entry, rangeEvidence) });
    }
    const current = CSS.highlights?.get('sci-semantic-search-current');
    return { buckets, currentRangeCount: current?.size || 0,
      currentRange: current?.size ? rangeEvidence(Array.from(current)[0]) : null };
  });
  for (const bucket of snapshot.buckets) {
    bucket.ranges = bucket.ranges.map(range => ({ paragraphId: range.paragraphId,
      textSha256: sha256(range.text) }));
  }
  if (snapshot.currentRange) snapshot.currentRange = {
    paragraphId: snapshot.currentRange.paragraphId,
    textSha256: sha256(snapshot.currentRange.text)
  };
  const readout = await semanticReadout(page);
  assert.ok(readout.total >= expectedMinimum, 'SEMANTIC_FIND_HTML_HITS_EMPTY');
  assert.ok(snapshot.buckets.length > 0 && snapshot.currentRangeCount > 0,
    'SEMANTIC_FIND_HTML_HIGHLIGHT_REGISTRY_EMPTY');
  assert.ok(snapshot.buckets.every(bucket => bucket.score >= 0 && bucket.score <= 1 &&
    bucket.rangeCount > 0), 'SEMANTIC_FIND_HTML_SCORE_BUCKET_INVALID');
  assertScoreVisualIntensity(snapshot.buckets,
    'SEMANTIC_FIND_HTML_SCORE_INTENSITY_NOT_MONOTONIC');
  return { ...snapshot, ...readout };
}

async function submitQuery(page, query, expectedMinimum = 1, source = 'html') {
  const input = page.locator('[data-semantic-find-role="query"]');
  await input.fill(query);
  await input.press('Enter');
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-semantic-find-role="status"]');
    return status?.dataset.state === 'success';
  }, null, { timeout: UI_TIMEOUT_MS });
  const hits = source === 'pdf'
    ? await inspectPdfHits(page, expectedMinimum)
    : await inspectHtmlHighlights(page, expectedMinimum);
  const progress = await page.locator('[data-semantic-find-role="progress"]').innerText();
  assert.match(progress, /已处理\s+\d+\s*\/\s*\d+/u,
    'SEMANTIC_FIND_PROGRESS_MISSING');
  return hits;
}

function assertHtmlProviderUiBinding(report, query, hits, requiredParagraphIds,
  excludedParagraphIds = []) {
  const expectedSourceByParagraph = new Map([
    ['positive-en', sha256(SOURCE_SENTENCES.positiveEnglish)],
    ['positive-zh', sha256(SOURCE_SENTENCES.positiveChinese)],
    ['positive-two', sha256(SOURCE_SENTENCES.secondPositive)],
    ['negative', sha256(SOURCE_SENTENCES.negative)],
    ['purpose-experiment', sha256(SOURCE_SENTENCES.purposeExperiment)]
  ]);
  const normalizedQuery = String(query || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const calls = report.provider.calls.filter(call => call.querySha256 === sha256(normalizedQuery));
  const decisions = calls.flatMap(call => call.decisions || []);
  const decisionByText = new Map(decisions.map(item => [item.textSha256, item]));
  const uiRanges = hits.buckets.flatMap(bucket => bucket.ranges.map(range => ({
    ...range, bucketScore: bucket.score
  })));
  const hitParagraphs = new Set(uiRanges.map(item => item.paragraphId));
  for (const paragraphId of requiredParagraphIds) {
    assert.ok(hitParagraphs.has(paragraphId),
      `SEMANTIC_FIND_REQUIRED_SOURCE_MISSING:${paragraphId}`);
    assert.ok(uiRanges.some(item => item.paragraphId === paragraphId &&
      item.textSha256 === expectedSourceByParagraph.get(paragraphId)),
    `SEMANTIC_FIND_REQUIRED_SOURCE_CHANGED:${paragraphId}`);
  }
  for (const paragraphId of excludedParagraphIds) {
    assert.equal(hitParagraphs.has(paragraphId), false,
      `SEMANTIC_FIND_EXCLUDED_SOURCE_MATCHED:${paragraphId}`);
  }
  for (const range of uiRanges) {
    const decision = decisionByText.get(range.textSha256);
    assert.ok(decision, `SEMANTIC_FIND_UI_DECISION_MISSING:${range.paragraphId}`);
    assert.equal(range.bucketScore, Math.round(decision.score * 100) / 100,
      `SEMANTIC_FIND_UI_SCORE_BUCKET_CHANGED:${range.paragraphId}`);
  }
  const currentDecision = decisionByText.get(hits.currentRange?.textSha256);
  assert.ok(currentDecision, 'SEMANTIC_FIND_CURRENT_DECISION_MISSING');
  assert.equal(hits.currentRange.textSha256, currentDecision.textSha256,
    'SEMANTIC_FIND_CURRENT_SOURCE_CHANGED');
  assert.equal(hits.score, Number(currentDecision.score.toFixed(3)),
    'SEMANTIC_FIND_CURRENT_RAW_SCORE_CHANGED');
  return true;
}

async function assertNavigation(page, expectedTotal) {
  const initial = await semanticReadout(page);
  assert.equal(initial.total, expectedTotal);
  await page.keyboard.press('Enter');
  const next = await semanticReadout(page);
  assert.notEqual(next.current, initial.current, 'SEMANTIC_FIND_ENTER_DID_NOT_ADVANCE');
  await page.keyboard.press('Shift+Enter');
  const previous = await semanticReadout(page);
  assert.equal(previous.current, initial.current, 'SEMANTIC_FIND_SHIFT_ENTER_DID_NOT_REVERSE');
  assert.equal(previous.score, initial.score, 'SEMANTIC_FIND_SHIFT_ENTER_SCORE_CHANGED');
  assert.ok(expectedTotal >= 2);
}

async function seedAutomaticHighlight(worker, tabId, pattern = 'preregistered') {
  const response = await contentMessage(worker, tabId, {
    action: 'applyHighlight', mode: 'word', analysisModeId: 'semantic-find-existing-ai',
    categories: { acceptance_existing_ai: {
      name: 'Existing AI control', color: '#98d7ff', isRegex: false,
      patterns: [pattern], excludePatterns: []
    } }
  });
  assert.equal(response?.success, true, `SEMANTIC_FIND_EXISTING_AI_FAILED:${response?.error || ''}`);
}

async function prepareManual(page, worker, tabId, paragraphId = 'existing-manual') {
  const prepared = await contentMessage(worker, tabId, { action: 'prepareManualAnnotations' });
  assert.equal(prepared?.success, true, `SEMANTIC_FIND_MANUAL_PREPARE_FAILED:${prepared?.error || ''}`);
  await page.locator(`#${paragraphId}`).evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    if (!first) throw new Error('SEMANTIC_FIND_MANUAL_TEXT_MISSING');
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(first, Math.min(first.textContent.length, 28));
    const selection = getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 20, clientY: 20 }));
  });
  await page.locator('#sci-manual-toolbar .sci-manual-category').first()
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#sci-manual-toolbar .sci-manual-category').first().click();
  await page.locator('.sci-manual-highlight').first().waitFor({ state: 'attached', timeout: 20_000 });
}

async function runCancelLateResult(page, source) {
  await page.keyboard.press('j');
  await waitForSemanticUi(page);
  const input = page.locator('[data-semantic-find-role="query"]');
  await input.fill('late cancel signal recovery increase');
  await input.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('.sci-semantic-find:not([hidden])').count(), 0,
    'SEMANTIC_FIND_CANCEL_PANEL_RETURNED');
  if (source === 'pdf') {
    assert.equal(await page.locator('.pdf-native-semantic-search-hit').count(), 0,
      'SEMANTIC_FIND_CANCEL_HITS_RETURNED');
    assert.equal(await page.locator('.pdf-native-semantic-search-layer').count(), 0,
      'SEMANTIC_FIND_CANCEL_LAYER_RETURNED');
  } else {
    const registry = await page.evaluate(() => ({
      current: CSS.highlights?.has('sci-semantic-search-current') || false,
      scores: Array.from({ length: 101 }, (_, index) =>
        CSS.highlights?.has(`sci-semantic-search-${index}`)).some(Boolean)
    }));
    assert.deepEqual(registry, { current: false, scores: false },
      'SEMANTIC_FIND_CANCEL_LAYER_RETURNED');
  }
}

async function htmlStage({ context, worker, extensionId, fixtureUrl, report, outputDirectory }) {
  const page = await context.newPage();
  await page.goto(fixtureUrl, { waitUntil: 'load' });
  let tabId = await existingTabId(worker, page.url());
  const assertInactive = async () => {
    const active = await worker.evaluate(async id =>
      SciLLM.isTabActivated(chrome.storage.session, await chrome.tabs.get(id)), tabId);
    assert.equal(active, false, 'SEMANTIC_FIND_MUST_NOT_ACTIVATE_SIDEBAR');
    assert.equal(context.pages().some(item => item.url().includes('/popup.html')), false);
  };
  const waitForShortcut = async key => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const value = await worker.evaluate(async id => (await chrome.scripting.executeScript({
        target: { tabId: id, frameIds: [0] },
        func: () => globalThis.__brevessSemanticFindShortcut?.shortcutKey
      }))[0]?.result, tabId);
      if (value === key) return;
      await page.waitForTimeout(100);
    }
    throw codedError('SEMANTIC_FIND_SHORTCUT_BOOTSTRAP_NOT_READY');
  };
  await waitForShortcut('J');
  await assertInactive();
  assert.equal(await page.evaluate(() => Boolean(document.documentElement.dataset.sciLlmContentRevision)), false,
    'SEMANTIC_FIND_EAGER_READER_INJECTION');
  // Remapping is persisted before the full reader exists, including disabling.
  const rpc = context.pages().find(item => item.url().startsWith('chrome-extension://'));
  const setKey = key => rpc.evaluate(async value => {
    const state = await chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' });
    const result = await chrome.runtime.sendMessage({ type: 'LLM_UPDATE_PREFERENCES',
      preferences: { keyboardShortcuts: { ...state.data.settings.keyboardShortcuts, semanticFind: value } } });
    if (!result?.success) throw new Error('SHORTCUT_PREFERENCE_FAILED');
  }, key);
  await setKey('');
  await waitForShortcut('');
  await page.keyboard.press('j');
  assert.equal(await page.locator('.sci-semantic-find').count(), 0);
  await setKey('K');
  await waitForShortcut('K');
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'shortcut-typing-check';
    document.body.append(input); input.focus();
  });
  await page.keyboard.type('jk');
  assert.equal(await page.locator('#shortcut-typing-check').inputValue(), 'jk');
  await page.locator('#shortcut-typing-check').evaluate(input => input.remove());
  assert.equal(await page.locator('.sci-semantic-find').count(), 0);
  await page.keyboard.press('j');
  assert.equal(await page.locator('.sci-semantic-find').count(), 0);
  await page.keyboard.press('k');
  await waitForSemanticUi(page);
  await page.keyboard.press('Escape');
  await assertInactive();
  await setKey('J');
  await waitForShortcut('J');
  report.checks.standaloneShortcut = { noPriorActivation: true, lazyReaderInjection: true,
    remappedKey: true, disabledKey: true, editableTyping: true, sidePanelNotOpened: true };
  await page.waitForFunction(() => Boolean(document.documentElement.dataset.sciLlmContentRevision),
    null, { timeout: 30_000 });
  await seedAutomaticHighlight(worker, tabId);
  await prepareManual(page, worker, tabId);
  const before = await page.evaluate(() => ({
    manual: document.querySelectorAll('.sci-manual-highlight').length,
    automatic: document.querySelectorAll('.sci-highlight,.sci-llm-highlight').length
  }));
  if (!(before.manual > 0 && before.automatic > 0)) {
    throw codedError('SEMANTIC_FIND_BASELINE_HIGHLIGHTS_EMPTY', JSON.stringify(before));
  }

  const query = await openWithJ(page);
  const recoveryChineseQuery = '寻找表示信号恢复增加的句子';
  const purposeChineseQuery = '为了验证某个目的，我们设计了下面的实验';
  const recoveryEnglishQuery = 'sentences reporting increased signal recovery';
  await query.fill(recoveryChineseQuery);
  report.checks.htmlVisualEvidence = [];
  const chineseHits = await submitQuery(page, recoveryChineseQuery, 3, 'html');
  report.checks.htmlVisualEvidence.push({ query: 'cross-language-recovery-zh',
    buckets: chineseHits.buckets });
  assertHtmlProviderUiBinding(report, recoveryChineseQuery, chineseHits,
    ['positive-en', 'positive-zh', 'positive-two'], ['negative']);
  if (report.execution.apiMode === 'fixture') {
    assert.ok(chineseHits.buckets.some(item => Math.abs(item.score - 0.96) < 1e-9));
    assert.ok(chineseHits.buckets.some(item => Math.abs(item.score - 0.92) < 1e-9));
  }
  await assertNavigation(page, chineseHits.total);

  const purposeHit = await submitQuery(page, purposeChineseQuery, 1,
    'html');
  report.checks.htmlVisualEvidence.push({ query: 'cross-language-purpose-zh',
    buckets: purposeHit.buckets });
  assertHtmlProviderUiBinding(report, purposeChineseQuery, purposeHit,
    ['purpose-experiment']);
  if (report.execution.apiMode === 'fixture') {
    assert.ok(purposeHit.buckets.some(item => Math.abs(item.score - 0.97) < 1e-9),
      'SEMANTIC_FIND_MERFISH_PURPOSE_SCORE_MISSING');
  }

  const englishHits = await submitQuery(page, recoveryEnglishQuery, 3,
    'html');
  report.checks.htmlVisualEvidence.push({ query: 'recovery-en', buckets: englishHits.buckets });
  assertHtmlProviderUiBinding(report, recoveryEnglishQuery, englishHits,
    ['positive-en', 'positive-zh', 'positive-two'], ['negative']);
  await assertNavigation(page, englishHits.total);
  const clickPoint = await page.locator('#positive-en').evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = [...range.getClientRects()].find(item => item.width > 10 && item.height > 5);
    if (!rect) return null;
    return { x: rect.left + Math.min(30, rect.width / 2), y: rect.top + rect.height / 2 };
  });
  assert.ok(clickPoint, 'SEMANTIC_FIND_HTML_HIT_CLICK_POINT_MISSING');
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await page.locator('#sci-manual-toolbar .sci-manual-category').first()
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#sci-manual-toolbar .sci-manual-category').first().click();
  await page.waitForFunction(count => document.querySelectorAll('.sci-manual-highlight').length > count,
    before.manual, { timeout: 20_000 });
  const confirmed = await page.locator('.sci-manual-highlight').count();
  await page.screenshot({ path: path.join(outputDirectory, 'html-semantic-find.png'), fullPage: true });
  await page.keyboard.press('Escape');
  const htmlRegistryAfterClose = await page.evaluate(() =>
    Array.from({ length: 101 }, (_, index) =>
      CSS.highlights?.has(`sci-semantic-search-${index}`)).some(Boolean));
  assert.equal(htmlRegistryAfterClose, false);
  const afterClose = await page.evaluate(() => ({
    manual: document.querySelectorAll('.sci-manual-highlight').length,
    automatic: document.querySelectorAll('.sci-highlight,.sci-llm-highlight').length
  }));
  assert.equal(afterClose.manual, confirmed);
  assert.equal(afterClose.automatic, before.automatic);

  await page.reload({ waitUntil: 'load' });
  await waitForShortcut('J');
  await openWithJ(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Boolean(document.documentElement.dataset.sciLlmContentRevision),
    null, { timeout: 30_000 });
  tabId = await existingTabId(worker, page.url());
  await contentMessage(worker, tabId, { action: 'prepareManualAnnotations' });
  await page.waitForFunction(count => document.querySelectorAll('.sci-manual-highlight').length >= count,
    confirmed, { timeout: 30_000 });
  const reloadManualCount = await page.locator('.sci-manual-highlight').count();
  await assertInactive();
  assert.equal(await page.locator('.sci-semantic-find:not([hidden])').count(), 0);
  if (report.execution.apiMode === 'fixture') await runCancelLateResult(page, 'html');
  const postCancelManualCount = await page.locator('.sci-manual-highlight').count();
  if (report.execution.apiMode === 'fixture') {
    assert.equal(postCancelManualCount, reloadManualCount,
      'SEMANTIC_FIND_CANCEL_REMOVED_PERSISTED_MANUAL');
  }
  report.checks.html = {
    chineseAndEnglishQueries: true,
    chineseExperimentPurposeMatchedEnglishMerfish: true,
    exactNoulScoresPreserved: true,
    scoreIntensityMonotonic: true,
    enterForwardShiftEnterBack: true,
    editableJPreserved: true,
    priorAutomaticCount: before.automatic,
    priorManualCount: before.manual,
    confirmedManualCount: confirmed,
    reloadManualCount,
    postCancelManualCount,
    cancelledLateResultStayedAbsent: report.execution.apiMode === 'fixture'
  };
  return page;
}

async function waitForPdfReady(page, expectedHash, expectedPageCount) {
  await page.waitForFunction(({ hash, pages }) => {
    const native = globalThis.__brevessNativePdfDocument;
    const semantic = globalThis.__brevessPdfSemanticDocument;
    return native?.phase === 'text-ready' && semantic?.phase === 'text-ready' &&
      native?.structure?.documentHash === hash && semantic?.documentHash === hash &&
      semantic?.indexedPageCount === pages && native?.getSemanticNavigation?.()?.sections?.length > 0;
  }, { hash: expectedHash, pages: expectedPageCount }, { timeout: UI_TIMEOUT_MS });
}

async function pdfStage({ context, worker, extensionId, pdfPath, pdfPageCount, report,
  outputDirectory }) {
  const readerUrl = `chrome-extension://${extensionId}/pdf-reader.html`;
  const pagePromise = context.waitForEvent('page', { timeout: 20_000 });
  const tabId = await worker.evaluate(async url => {
    const tab = await chrome.tabs.create({ url, active: true });
    if (!Number.isSafeInteger(tab?.id)) throw new Error('SEMANTIC_FIND_TAB_CREATE_FAILED');
    return tab.id;
  }, readerUrl);
  const page = await pagePromise;
  await page.waitForURL(url => url.href.startsWith(readerUrl), { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#pdfLocalFile').setInputFiles(pdfPath);
  await waitForPdfReady(page, report.source.executionPdfSha256, pdfPageCount);
  assert.equal(await worker.evaluate(async id =>
    SciLLM.isTabActivated(chrome.storage.session, await chrome.tabs.get(id)), tabId), false);
  report.checks.pdfWithoutSidebarActivation = true;
  await seedAutomaticHighlight(worker, tabId, 'Microglial');

  await openWithJ(page);
  const hits = await submitQuery(page, 'microglial motility and neuronal activity', 2, 'pdf');
  report.checks.pdfVisualEvidence = { initial: hits };
  const pdfReadout = await semanticReadout(page);
  await assertNavigation(page, pdfReadout.total);
  await page.locator('.pdf-native-semantic-search-hit[data-current="true"]').first()
    .waitFor({ state: 'attached', timeout: 30_000 });
  const currentBefore = hits.find(item => item.current);
  const pageNumber = await page.locator('.pdf-native-semantic-search-hit[data-current="true"]')
    .first()
    .evaluate(node => Number(node.closest('[data-pdf-page-number]')?.dataset.pdfPageNumber || 0));
  assert.ok(pageNumber > 0, 'SEMANTIC_FIND_PDF_PAGE_MISSING');
  await page.locator('.pdf-native-semantic-search-hit').evaluateAll(nodes => {
    globalThis.__semanticFindAcceptanceNodesBeforeZoom = [...nodes];
  });
  const scaleBefore = await page.evaluate(() =>
    globalThis.__brevessPdfReaderBridge.command('getState').scale);
  await page.evaluate(scale => globalThis.__brevessPdfReaderBridge.command('setScale', scale + 0.27),
    scaleBefore);
  await page.waitForTimeout(450);
  const repainted = await inspectPdfHits(page, 2);
  report.checks.pdfVisualEvidence.afterZoom = repainted;
  assert.equal(repainted.find(item => item.current)?.id, currentBefore.id,
    'SEMANTIC_FIND_PDF_CURRENT_LOST_AFTER_ZOOM');
  const replacedNodeCount = await page.locator('.pdf-native-semantic-search-hit')
    .evaluateAll(nodes => nodes.filter(node =>
      !globalThis.__semanticFindAcceptanceNodesBeforeZoom?.includes(node)).length);
  assert.ok(replacedNodeCount > 0,
    'SEMANTIC_FIND_PDF_ZOOM_DID_NOT_REPAINT');

  if (report.execution.apiMode === 'fixture') {
    const farPage = pageNumber === pdfPageCount ? 1 : pdfPageCount;
    await page.evaluate(number => globalThis.__brevessPdfReaderBridge.command(
      'updatePageWindow', number, number), farPage);
    await page.waitForFunction(number =>
      !document.querySelector(`.pdf-native-page[data-pdf-page-number="${number}"].is-rendered .pdf-native-text-layer`), pageNumber,
    { timeout: 30_000 });
    await page.evaluate(number => globalThis.__brevessPdfReaderBridge.command(
      'updatePageWindow', number, number), pageNumber);
    await page.waitForFunction(({ number, id }) => Boolean(document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${number}"] .pdf-native-semantic-search-hit[data-semantic-find-id="${CSS.escape(id)}"]`
    )), { number: pageNumber, id: currentBefore.id }, { timeout: 30_000 });
    const restored = await inspectPdfHits(page, 1);
    assert.ok(restored.some(item => item.id === currentBefore.id && item.current));
  }

  await page.locator('.pdf-native-semantic-search-hit[data-current="true"]').first().click();
  await page.locator('#sci-manual-toolbar .sci-manual-category').first()
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#sci-manual-toolbar .sci-manual-category').first().click();
  await page.locator('.pdf-native-annotation-hit').first()
    .waitFor({ state: 'attached', timeout: 30_000 });
  const confirmedManualCount = await page.locator('.pdf-native-annotation-hit').count();
  await page.screenshot({ path: path.join(outputDirectory, 'pdf-semantic-find.png'), fullPage: false });

  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pdf-native-semantic-search-layer').count(), 0,
    'SEMANTIC_FIND_PDF_TEMP_LAYER_RETAINED');
  assert.ok(await page.locator('.pdf-native-regex-hit').count() > 0,
    'SEMANTIC_FIND_PDF_EXISTING_AI_REMOVED');
  assert.equal(await page.locator('.pdf-native-annotation-hit').count(), confirmedManualCount,
    'SEMANTIC_FIND_PDF_ESCAPE_REMOVED_MANUAL');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(document.documentElement.dataset.sciLlmContentRevision),
    null, { timeout: 30_000 });
  await page.locator('#pdfLocalFile').setInputFiles(pdfPath);
  await waitForPdfReady(page, report.source.executionPdfSha256, pdfPageCount);
  const manualPrepared = await contentMessage(worker, tabId, { action: 'prepareManualAnnotations' });
  assert.equal(manualPrepared?.success, true,
    `SEMANTIC_FIND_PDF_MANUAL_RESTORE_PREPARE_FAILED:${manualPrepared?.error || ''}`);
  await page.evaluate(number => globalThis.__brevessPdfReaderBridge.command(
    'updatePageWindow', number, number), pageNumber);
  await page.locator('.pdf-native-annotation-hit').first()
    .waitFor({ state: 'attached', timeout: 30_000 });
  const reloadManualCount = await page.locator('.pdf-native-annotation-hit').count();
  assert.ok(reloadManualCount > 0, 'SEMANTIC_FIND_PDF_MANUAL_NOT_RESTORED');
  if (report.execution.apiMode === 'fixture') {
    await runCancelLateResult(page, 'pdf');
    assert.ok(await page.locator('.pdf-native-annotation-hit').count() > 0,
      'SEMANTIC_FIND_PDF_CANCEL_REMOVED_RESTORED_MANUAL');
  }
  report.checks.pdf = {
    originalPdfPageCount: report.source.originalPdfPageCount,
    searchedPdfPageCount: pdfPageCount,
    queryThroughJUi: true,
    currentHitPageNumber: pageNumber,
    score: currentBefore.score,
    zoomRepainted: true,
    virtualUnmountRestored: report.execution.apiMode === 'fixture',
    escapeClearedTemporaryLayer: true,
    priorAutomaticRetained: true,
    confirmedManualCount,
    reloadManualCount,
    cancelledLateResultStayedAbsent: report.execution.apiMode === 'fixture'
  };
  return page;
}

async function run(options = {}) {
  const normalized = options.extensionRoot && options.outputDirectory
    ? Object.freeze({ ...normalizeOptions([], options), ...options })
    : normalizeOptions([], options);
  if (normalized.help) return { help: helpText() };
  createOutputDirectory(normalized.outputDirectory);
  const reportFile = path.join(normalized.outputDirectory, 'report.json');
  const report = {
    schemaVersion: 1,
    status: 'RUNNING',
    acceptance: 'J semantic find HTML and original-page PDF live acceptance',
    execution: {
      realBrowser: true,
      browser: normalized.browser,
      isolatedExtension: true,
      isolatedProfile: true,
      apiMode: normalized.apiMode,
      fixtureIsRealApi: false,
      callCap: normalized.callCap,
      diagnosticTemporaryContentInstrumentation: normalized.diagnoseManual === true,
      diagnosticTemporaryInjectionInstrumentation: normalized.diagnoseInjection === true
    },
    source: {},
    provider: { realCalls: 0, capRejected: false, calls: [] },
    diagnostics: { pageErrors: [], consoleErrors: [], workerErrors: [], proxyErrors: [] },
    checks: {},
    stage: 'START',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    elapsedMs: 0,
    failureCode: ''
  };
  let secret = '';
  let server = null;
  let context = null;
  let worker = null;
  let temporaryRoot = '';
  let executionPdfPath = normalized.pdfPath;
  let executionPdfPageCount = 0;
  const persist = () => writeReport(reportFile, report, secret);
  persist();
  try {
    assert.ok(fs.existsSync(path.join(normalized.extensionRoot, 'manifest.json')),
      'SEMANTIC_FIND_EXTENSION_ROOT_INVALID');
    if (normalized.pdf) {
      assert.ok(fs.existsSync(normalized.pdfPath), 'SEMANTIC_FIND_PDF_MISSING');
    }
    const sourceFiles = [
      'manifest.json', 'background.js', 'content.js', 'content.css', 'pdf-reader.html',
      'pdf-native-reader.mjs', 'semantic-find-controller.js', 'semantic-find-content.js',
      'core/semantic-find.js', 'core/background-router.js', 'core/tab-messenger.js',
      'semantic-find-launcher.js', 'core/semantic-find-launcher.js',
      'providers/typesafe.js'
    ];
    const originalPdfSha256 = normalized.pdf ? sha256File(normalized.pdfPath) : '';
    const isDefaultPublicPdf = originalPdfSha256 === EXPECTED_PDF_SHA256;
    report.source = {
      pdfSha256: originalPdfSha256,
      originalPdfSha256,
      originalPdfPageCount: normalized.pdf && isDefaultPublicPdf ? 23 : 0,
      executionPdfSha256: originalPdfSha256,
      executionPdfPageCount: normalized.pdf && isDefaultPublicPdf ? 23 : 0,
      executionPdfKind: normalized.apiMode === 'real-api' ? 'derived-public-pages' : 'original-public-pdf',
      derivedSourcePageNumbers: [],
      expectedPublicPdfSha256: normalized.pdf ? EXPECTED_PDF_SHA256 : '',
      fixtureHtmlSha256: sha256(fixtureHtml()),
      sourceHashes: Object.fromEntries(sourceFiles.map(file => {
        const filename = path.join(normalized.extensionRoot, file);
        return [file, fs.existsSync(filename) ? sha256File(filename) : 'MISSING'];
      }))
    };
    if (normalized.pdf && normalized.pdfPath === DEFAULT_PDF) {
      assert.equal(originalPdfSha256, EXPECTED_PDF_SHA256,
        'SEMANTIC_FIND_PUBLIC_PDF_HASH_MISMATCH');
    }
    if (normalized.pdf && !isDefaultPublicPdf) {
      throw codedError('SEMANTIC_FIND_PUBLIC_PDF_UNRECOGNIZED');
    }
    if (normalized.pdf && normalized.apiMode === 'real-api') {
      const derived = deriveRealApiPdf(normalized.pdfPath,
        path.join(normalized.outputDirectory, 'public-elife-83176-pages-1-2.pdf'), [1, 2]);
      executionPdfPath = derived.path;
      executionPdfPageCount = derived.pageNumbers.length;
      report.source.executionPdfSha256 = derived.sha256;
      report.source.executionPdfPageCount = executionPdfPageCount;
      report.source.derivedSourcePageNumbers = derived.pageNumbers;
      report.source.derivedArtifact = path.basename(derived.path);
    } else if (normalized.pdf) {
      executionPdfPageCount = report.source.originalPdfPageCount;
    }
    if (normalized.apiMode === 'real-api') {
      report.stage = 'REAL_API_SECRET'; persist();
      const { readSecretFromTty } = await import('./probe-deepseek-figure-recovery.mjs');
      secret = await readSecretFromTty({ prompt: 'Authorized TypeSafe key (masked, memory only): ' });
      if (!secret) throw codedError('TTY_REQUIRED');
    }
    report.stage = 'SERVER'; persist();
    server = await startServer({ mode: normalized.apiMode, getSecret: () => secret,
      callCap: normalized.callCap, report, persist, assetRoot: normalized.extensionRoot });
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
    const extensionDirectory = path.join(temporaryRoot, 'extension');
    const profileDirectory = path.join(temporaryRoot, 'profile');
    copyExtension(normalized.extensionRoot, extensionDirectory, port,
      { diagnoseManual: normalized.diagnoseManual,
        diagnoseInjection: normalized.diagnoseInjection });

    report.stage = 'BROWSER'; persist();
    const { chromium } = await import('playwright');
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: normalized.browser, headless: !normalized.headed, reducedMotion: 'reduce',
      viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${extensionDirectory}`,
        `--load-extension=${extensionDirectory}`]
    });
    const note = attachDiagnostics(context, report);
    await context.route(/^https?:\/\//u, route => {
      const parsed = new URL(route.request().url());
      if (parsed.origin === origin) return route.continue();
      note('consoleErrors', `blocked network ${parsed.origin}${parsed.pathname}`);
      return route.abort('blockedbyclient');
    });
    worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', { timeout: 30_000 });
    worker.on('console', message => {
      if (message.type() === 'error') note('workerErrors', message.text());
    });
    const extensionId = new URL(worker.url()).host;
    const rpc = await context.newPage();
    await rpc.goto(`chrome-extension://${extensionId}/semantic-find-acceptance-rpc.html`);
    report.checks.profile = await configureProfile(rpc);
    assert.deepEqual(report.checks.profile, {
      profileStored: true,
      routeProfileId: 'profile_semantic_find_acceptance',
      credentialMasked: true
    });

    // Deliberately never open or activate the sidebar: the shortcut must own
    // startup in an untouched article and the built-in PDF reader.
    if (normalized.html) {
      report.stage = 'HTML'; persist();
      await htmlStage({ context, worker, extensionId,
        fixtureUrl: `${origin}/fixture/article.html`, report,
        outputDirectory: normalized.outputDirectory });
    }
    if (normalized.pdf) {
      report.stage = 'PDF'; persist();
      await pdfStage({ context, worker, extensionId, pdfPath: executionPdfPath,
        pdfPageCount: executionPdfPageCount, report,
        outputDirectory: normalized.outputDirectory });
    }
    if (normalized.diagnoseInjection && worker) {
      report.diagnostics.injectionLifecycle = await collectInjectionDiagnostics(context, worker);
    }
    assert.ok(report.provider.calls.length > 0, 'SEMANTIC_FIND_PROVIDER_NOT_CALLED');
    assert.ok(report.provider.calls.length <= normalized.callCap,
      'SEMANTIC_FIND_PROVIDER_CALL_CAP_EXCEEDED');
    assert.equal(report.provider.capRejected, false);
    if (normalized.apiMode === 'fixture') assert.equal(report.provider.realCalls, 0);
    else assert.ok(report.provider.realCalls > 0);
    assert.equal(report.diagnostics.pageErrors.length, 0, 'SEMANTIC_FIND_PAGE_ERRORS');
    assert.equal(report.diagnostics.consoleErrors.length, 0, 'SEMANTIC_FIND_CONSOLE_ERRORS');
    assert.equal(report.diagnostics.workerErrors.length, 0, 'SEMANTIC_FIND_WORKER_ERRORS');
    assert.equal(report.diagnostics.proxyErrors.length, 0, 'SEMANTIC_FIND_PROXY_ERRORS');
    report.status = 'PASS';
    report.stage = 'COMPLETE';
    return report;
  } catch (error) {
    report.status = 'FAIL';
    report.failureCode = safeCode(error);
    report.failureMessage = redactDiagnostic(error?.message || error, secret);
    if (normalized.diagnoseManual && context) {
      report.diagnostics.manualLifecycle = [];
      for (const page of context.pages()) {
        const rows = await page.evaluate(() =>
          Array.isArray(globalThis.__semanticFindManualDiagnostic)
            ? structuredClone(globalThis.__semanticFindManualDiagnostic) : []
        ).catch(() => []);
        report.diagnostics.manualLifecycle.push(...rows);
      }
    }
    if (normalized.diagnoseInjection && worker) {
      report.diagnostics.injectionLifecycle = await collectInjectionDiagnostics(context, worker);
    }
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
    secret = '';
    await context?.close().catch(() => undefined);
    await closeServer(server).catch(() => undefined);
    if (temporaryRoot) {
      try { removeTemporary(temporaryRoot); report.cleanup = { temporaryRemoved: true }; }
      catch (error) { report.cleanup = { temporaryRemoved: false, errorCode: safeCode(error) }; }
    }
    writeReport(reportFile, report);
  }
}

const directExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directExecution) {
  const parsed = normalizeOptions(process.argv.slice(2));
  if (parsed.help) process.stdout.write(`${helpText()}\n`);
  else run(parsed).then(report => {
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      apiMode: report.execution.apiMode,
      realCalls: report.provider.realCalls,
      calls: report.provider.calls.length,
      outputDirectory: parsed.outputDirectory
    }, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`FAIL ${safeCode(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  assertExactDecision,
  assertHtmlProviderUiBinding,
  assertSafeReport,
  assertScoreVisualIntensity,
  buildFixtureDecision,
  fixtureHtml,
  helpText,
  normalizeOptions,
  run,
  safeCode,
  scoreFixtureSentence,
  validateSemanticFindRequest
};
