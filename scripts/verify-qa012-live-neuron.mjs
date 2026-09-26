// QA-012 acceptance only: real production chat chain, explicit public source,
// isolated Edge/OPFS, transparent bounded curl transport. No fabricated answers.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sanitizedReplay } from './verify-live-web-chat-extension.mjs';
import { createCurlFetch } from './lib/live-curl-fetch.mjs';
import { loadLivePortableProfile } from './lib/live-portable-profile.mjs';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';

export const TITLE = 'Anterior zona incerta to ventral tegmental area circuit controls compulsive eating in a binge-eating-disorder mouse model';
export const DOI = '10.1016/j.neuron.2026.08.014';
export const MODEL = 'deepseek-flash';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const QUESTIONS = Object.freeze([
  '这篇论文的核心研究问题是什么？请简要回答并引用原文。',
  '作者使用了什么暴食障碍动物模型？请简要回答并引用原文。',
  'aZI 到 VTA 环路的主要发现是什么？请简要回答并引用原文。',
  '列表格总结这篇文献用到的所有病毒工具,并且简要概括一下该病毒工具的使用目的。'
]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { verifyArticleChatEvidence } = createRequire(import.meta.url)('../core/article-chat-citations.js');
const MAX_BYTES = 8 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const norm = value => String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const titleKey = value => norm(value).replace(/[.。]$/u, '').toLowerCase();
const safeCode = error => /^[A-Z][A-Z0-9_]{2,80}$/u.test(error?.code || '') ? error.code : 'QA012_ACCEPTANCE_FAILED';
const escapeHtml = value => String(value).replace(/[&<>"']/gu, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);

export function isArticleUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.search && !u.hash && (
      (u.hostname === 'www.cell.com' && decodeURIComponent(u.pathname) === '/neuron/fulltext/S0896-6273(26)00644-6') ||
      (u.hostname === 'www.sciencedirect.com' && u.pathname === '/science/article/pii/S0896627326006446'));
  } catch { return false; }
}

export function parseArguments(argv) {
  const out = { model: MODEL, transport: 'curl', callCap: 15, providerTimeoutMs: 180000, deadlineMs: 1800000,
    preflightOnly: false, retryFailedOnce: false, headed: false };
  const flags = new Map([['--preflight-only', 'preflightOnly'], ['--retry-failed-once', 'retryFailedOnce'], ['--headed', 'headed'],
    ['--persistence-only', 'persistenceOnly'], ['--verify-updated-source', 'verifyUpdatedSource']]);
  const values = new Set(['article', 'extension-root', 'output-dir', 'portable-config', 'profile', 'profile-model-override',
    'model', 'transport', 'call-cap', 'provider-timeout-ms', 'deadline-ms', 'resume-run']);
  for (let i = 0; i < argv.length; i++) {
    if (flags.has(argv[i])) { out[flags.get(argv[i])] = true; continue; }
    const name = argv[i].slice(2), value = argv[++i];
    if (!argv[i - 1].startsWith('--') || !values.has(name) || !value || value.startsWith('--')) fail('QA012_ARGUMENT_INVALID');
    out[name.replace(/-([a-z])/gu, (_, x) => x.toUpperCase())] = value;
  }
  if (!out.article || out.model !== MODEL || out.transport !== 'curl') fail('QA012_ARGUMENT_INVALID');
  for (const [key, min, max] of [['callCap', 4, 32], ['providerTimeoutMs', 1000, 180000], ['deadlineMs', 10000, 3600000]]) {
    out[key] = Number(out[key]);
    if (!Number.isSafeInteger(out[key]) || out[key] < min || out[key] > max) fail('QA012_ARGUMENT_INVALID');
  }
  if (Boolean(out.portableConfig) !== Boolean(out.profile)) fail('QA012_PROFILE_REQUIRED');
  if (out.profileModelOverride && (!out.portableConfig || out.profileModelOverride !== MODEL)) fail('QA012_MODEL_OVERRIDE_INVALID');
  if ((out.persistenceOnly && (!out.resumeRun || out.portableConfig || out.profile || out.retryFailedOnce)) ||
      (out.verifyUpdatedSource && !out.persistenceOnly)) fail('QA012_PERSISTENCE_ARGUMENT_INVALID');
  return out;
}

export function sourceCoverage(paragraphs) {
  const methods = paragraphs.filter(p => /methods?|method details|实验方法|材料与方法/iu.test(p.section));
  const resources = paragraphs.filter(p => /key resources|resources? table|关键资源|资源表/iu.test(p.section));
  const aav = paragraphs.filter(p => /\bAAV(?:\d|[-/\s])|adeno[- ]associated/iu.test(p.text));
  const substantiveIds = rows => norm(rows.map(p => p.text).join(' ')).length >= 40 ? rows.map(p => p.id) : [];
  return { methodsIds: substantiveIds(methods), resourceIds: substantiveIds(resources), aavIds: aav.map(p => p.id) };
}

export function loadArticle(file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_BYTES) fail('QA012_SOURCE_INVALID');
  const bytes = fs.readFileSync(file);
  let raw;
  try { raw = JSON.parse(bytes.toString('utf8')); } catch { fail('QA012_SOURCE_INVALID'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('QA012_SOURCE_INVALID');
  if (titleKey(raw.title) !== titleKey(TITLE) || !isArticleUrl(raw.url) || (raw.doi && raw.doi !== DOI)) fail('QA012_SOURCE_IDENTITY');
  if (!isArticleUrl(raw.provenance?.sourceUrl) || !Number.isFinite(Date.parse(raw.provenance?.capturedAt))) fail('QA012_SOURCE_PROVENANCE');
  if (!Array.isArray(raw.paragraphs) || raw.paragraphs.length < 1 || raw.paragraphs.length > 5000) fail('QA012_SOURCE_INVALID');
  const paragraphs = raw.paragraphs.map((p, i) => ({ id: String(Array.isArray(p) ? p[0] : p.id || p.paragraphId || `p${i + 1}`),
    section: norm(Array.isArray(p) ? p[1] : p.section || p.sectionTitle), text: String(Array.isArray(p) ? p[2] : p.text || '').trim() }));
  if (paragraphs.some(p => !p.id || p.id.length > 160 || !p.section || !p.text || Buffer.byteLength(p.text) > 250000) ||
      new Set(paragraphs.map(p => p.id)).size !== paragraphs.length) fail('QA012_SOURCE_INVALID');
  const coverage = sourceCoverage(paragraphs);
  if (!coverage.methodsIds.length || !coverage.resourceIds.length || !coverage.aavIds.length) fail('QA012_SOURCE_COVERAGE');
  return { title: String(raw.title).trim(), url: raw.url, doi: DOI, paragraphs, coverage,
    provenance: { sourceUrl: raw.provenance.sourceUrl, capturedAt: raw.provenance.capturedAt }, sourceSha256: hash(bytes) };
}

export async function loadCredential(args, deps = {}) {
  if (args.persistenceOnly) return { secret: 'qa012-network-disabled', metadata: { mode: 'none; persistence-only, all provider calls blocked' } };
  if (Boolean(args.portableConfig) !== Boolean(args.profile)) fail('QA012_PROFILE_REQUIRED');
  if (args.profileModelOverride && (!args.portableConfig || args.profileModelOverride !== MODEL)) fail('QA012_MODEL_OVERRIDE_INVALID');
  let secret, metadata;
  if (args.portableConfig) {
    const profile = await (deps.loadProfile || loadLivePortableProfile)(args.portableConfig, args.profile,
      { expectedModel: args.profileModelOverride ? undefined : MODEL });
    let u;
    try { u = new URL(profile.baseUrl || ENDPOINT); } catch { fail('QA012_PROFILE_MISMATCH'); }
    if (profile.providerId !== 'deepseek' || u.origin !== 'https://api.deepseek.com' || u.username || u.password || u.search || u.hash ||
        !['/', '/v1', '/v1/', '/chat/completions', '/responses'].includes(u.pathname) ||
        (profile.model !== MODEL && args.profileModelOverride !== MODEL)) fail('QA012_PROFILE_MISMATCH');
    secret = profile.apiKey;
    metadata = { mode: 'portable hidden TTY; memory-only key', sourceSha256: profile.sourceSha256,
      savedModel: profile.model, requestedModel: MODEL, explicitModelOverride: args.profileModelOverride || null };
  } else {
    secret = await (deps.readSecret || readSecretFromTty)({ prompt: 'DeepSeek API key for QA-012 (hidden): ' });
    metadata = { mode: 'hidden TTY; memory-only key', requestedModel: MODEL };
  }
  if (typeof secret !== 'string' || !secret.trim() || /[\r\n]/u.test(secret)) fail('QA012_CREDENTIAL_INVALID');
  const result = { metadata };
  Object.defineProperty(result, 'secret', { value: secret, enumerable: false });
  return result;
}

export function inspectRequest(body, article) {
  if (body?.model !== MODEL || !Array.isArray(body.messages) || (body.stream !== true && body.stream !== false)) fail('QA012_REQUEST_INVALID');
  const text = body.messages.filter(m => m.role === 'user' && typeof m.content === 'string').map(m => m.content).join('\n');
  const start = text.indexOf('ARTICLE_CONTEXT\n'), end = text.indexOf('\nCHAT_REQUEST\n', start);
  if (start < 0 || end < 0) fail('QA012_REQUEST_CONTEXT');
  let source, request;
  try { source = JSON.parse(text.slice(start + 16, end)).article; request = JSON.parse(text.slice(end + 14)); }
  catch { fail('QA012_REQUEST_CONTEXT'); }
  if (titleKey(source?.title) !== titleKey(article.title) || source?.canonical_url !== article.url || !source.document_hash ||
      !Array.isArray(source.chunks) || !source.chunks.length || !QUESTIONS.some(q => norm(q) === norm(request.current_question))) fail('QA012_REQUEST_IDENTITY');
  if (article.runtimeDocumentHash && source.document_hash !== article.runtimeDocumentHash) fail('QA012_REQUEST_IDENTITY');
  const chunks = source.chunks;
  if (chunks.some(c => !Array.isArray(c.sourceSpans) || !c.sourceSpans.length || typeof c.text !== 'string')) fail('QA012_REQUEST_CONTEXT');
  const coverage = sourceCoverage(chunks.map((c, i) => ({ id: String(i), section: c.sectionTitle || '', text: c.text })));
  // Check actual final-question input, not a dataset flag. Smaller prior questions may select fewer sections.
  if (norm(request.current_question) === norm(QUESTIONS[3])) {
    const sent = norm(chunks.map(c => c.text).join('\n'));
    const required = new Set([...article.coverage.methodsIds, ...article.coverage.resourceIds, ...article.coverage.aavIds]);
    if (article.paragraphs.some(p => required.has(p.id) && !sent.includes(norm(p.text)))) fail('QA012_SENT_COVERAGE_INCOMPLETE');
  }
  return { question: request.current_question, stream: body.stream, documentHash: source.document_hash,
    sourceSpanCount: chunks.reduce((n, c) => n + c.sourceSpans.length, 0), coverage,
    historyCount: Array.isArray(request.conversation_history) ? request.conversation_history.length : 0 };
}

export function createForwarder({ article, secret, callCap, timeoutMs, signal, fetchImpl = createCurlFetch({ timeoutMs }), record = () => {} }) {
  if (!Number.isSafeInteger(callCap) || callCap < 1 || callCap > 32 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) fail('QA012_TRANSPORT_LIMIT_INVALID');
  let calls = 0;
  return { get calls() { return calls; }, async forward(bodyText) {
    if (signal?.aborted) fail('QA012_DEADLINE');
    if (Buffer.byteLength(bodyText) > MAX_BYTES) fail('QA012_REQUEST_TOO_LARGE');
    let body;
    try { body = JSON.parse(bodyText); } catch { fail('QA012_REQUEST_INVALID'); }
    const summary = inspectRequest(body, article);
    if (calls >= callCap) fail('QA012_CALL_CAP');
    const sequence = ++calls; // Reserve before awaiting; concurrent callers share the same cap.
    const entry = { sequence, request: summary, startedAt: new Date().toISOString(), status: null };
    record(entry, { request: bodyText });
    try {
      const response = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: bodyText, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 16 * 1024 * 1024) fail('QA012_RESPONSE_TOO_LARGE');
      if (bytes.includes(Buffer.from(secret))) fail('QA012_RESPONSE_SECRET');
      Object.assign(entry, { status: response.status, responseBytes: bytes.length, responseSha256: hash(bytes), completedAt: new Date().toISOString() });
      record(entry, { response: bytes.toString('utf8') });
      return { status: response.status, contentType: response.headers.get('content-type') || 'application/json', bytes };
    } catch (error) { entry.errorCode = safeCode(error); record(entry, {}); throw error; }
  } };
}

export function inspectTurn(turn, paragraphs, expectTable = false, { collectKnownMissing = false } = {}) {
  if (turn?.status !== 'completed' || !Array.isArray(turn.answerBlocks) || !turn.answerBlocks.length) fail('QA012_TURN_NOT_COMPLETED');
  if (turn.webSearch?.enabled || turn.webSearch?.searched) fail('QA012_UNEXPECTED_WEB_SEARCH');
  let citations = 0, tableRows = 0;
  const citationIssues = [];
  const paragraphById = new Map(paragraphs.map(p => [p.paragraphId, p]));
  for (const block of turn.answerBlocks) {
    if (!norm(block.markdown)) fail('QA012_EMPTY_ANSWER');
    const evidence = block.evidence || [], markers = new Set(evidence.map(e => String(e.marker)));
    const used = [...block.markdown.matchAll(/\[\[(\d{1,3})\]\]/gu)].map(m => m[1]);
    if (markers.size !== evidence.length || used.some(m => !markers.has(m)) || evidence.some(e => !used.includes(String(e.marker)))) fail('QA012_CITATION_MARKER');
    for (const e of evidence) {
      const p = paragraphById.get(e.paragraphId);
      const verified = verifyArticleChatEvidence(e, { paragraphs, revision: Number(e.documentRevision) || 0 });
      if (!p || !e.quote || e.sourceKey !== p.sourceKey || e.textHash !== p.textHash) fail('QA012_CITATION_BINDING');
      const storedStatus = e.verificationStatus || e.verification?.status;
      if (storedStatus !== 'verified' || verified.status !== 'verified' || !verified.target?.quoteSpan) {
        // Keep known citation failures as failures, but finish independent chat,
        // table and persistence checks. A false verified claim or wrong identity
        // remains fatal; nothing is reclassified or rewritten in the product.
        if (!collectKnownMissing || storedStatus !== 'missing' || verified.status !== 'missing') fail('QA012_CITATION_BINDING');
        citationIssues.push({ blockId: block.blockId, marker: e.marker, paragraphId: e.paragraphId,
          storedStatus, checkedStatus: verified.status, code: verified.code || 'EVIDENCE_NOT_FOUND' });
      }
      citations++;
    }
    const lines = block.markdown.split(/\r?\n/u);
    const cells = line => line.trim().replace(/^\||\|$/gu, '').split(/(?<!\\)\|/u).map(x => x.trim());
    for (let i = 1; i < lines.length; i++) {
      const separators = cells(lines[i]);
      if (separators.length < 2 || !separators.every(c => /^:?-{3,}:?$/u.test(c)) || !lines[i - 1].includes('|')) continue;
      for (let j = i + 1; j < lines.length && lines[j].includes('|') && cells(lines[j]).length >= 2; j++) {
        tableRows++;
        if (expectTable && !/\[\[\d{1,3}\]\]/u.test(lines[j])) fail('QA012_TABLE_ROW_UNCITED');
      }
    }
  }
  if (!citations || (expectTable && !tableRows)) fail('QA012_ANSWER_EVIDENCE_MISSING');
  return { turnId: turn.turnId, status: turn.status, blockCount: turn.answerBlocks.length, citations, tableRows,
    verifiedCitations: citations - citationIssues.length, citationIssues,
    answerSha256: hash(JSON.stringify(turn.answerBlocks)) };
}

export function hasConfirmedDirectorySave(message, turnCount = QUESTIONS.length) {
  const match = /^已保存\s+(\d+)\s+个工作区文件和\s+(\d+)\s+轮问答到本地文件夹(?:[，。]|$)/u.exec(String(message || '').trim());
  return Boolean(match && Number(match[1]) > 0 && Number(match[2]) === turnCount);
}

export function selectColdRestoreResumeExpectation(previous, failure, before, saved) {
  if (previous?.phase?.name !== 'waiting-cold-restoration' || !Array.isArray(failure?.turns) || failure.turns.length !== 0 ||
      !before?.documentId || !before.documentHash || before.documentId !== failure.documentId || before.documentHash !== failure.documentHash ||
      !Array.isArray(before.turns) || before.turns.length !== QUESTIONS.length ||
      before.turns.some((turn, i) => turn.status !== 'completed' || !turn.turnId || norm(turn.question) !== norm(QUESTIONS[i])) ||
      !Array.isArray(previous.turns) || previous.turns.length !== QUESTIONS.length ||
      previous.turns.some((turn, i) => turn.status !== 'completed' || turn.turnId !== before.turns[i].turnId) ||
      !isDeepStrictEqual(saved, previous.saveDirectory) || saved?.exactChatPersisted !== true ||
      saved.flushed?.failed !== 0 || saved.flushed?.pendingCount !== 0 || saved.flushed?.permission !== 'granted' ||
      saved.status?.pendingCount !== 0 || saved.status?.permission !== 'granted' || !hasConfirmedDirectorySave(saved.saveUi)) fail('QA012_RESUME_INVALID');
  return before; // Expected result only. Never insert these turns into production state.
}

export function loadResumeRun(directory, article, extensionRoot, { outputRoot = path.join(root, 'output'), temporaryRoot = os.tmpdir(),
  persistenceOnly = false, verifyUpdatedSource = false } = {}) {
  if (verifyUpdatedSource && !persistenceOnly) fail('QA012_PERSISTENCE_ARGUMENT_INVALID');
  const inside = (parent, child) => { const relative = path.relative(fs.realpathSync(parent), fs.realpathSync(child));
    return !!relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
  const dir = path.resolve(directory);
  if (!inside(outputRoot, dir)) fail('QA012_RESUME_INVALID');
  const bytes = fs.readFileSync(path.join(dir, 'report.json')), previous = JSON.parse(bytes);
  const profile = previous.isolatedProfile;
  if (previous.taskId !== 'QA-012' || previous.browserClosed !== true || !previous.articleFileUnchanged ||
      !previous.sourceFilesUnchanged || previous.source?.sourceSha256 !== article.sourceSha256 ||
      !profile || path.basename(profile) !== 'profile' || !/^brevess-qa012-live-[a-zA-Z0-9]+$/u.test(path.basename(path.dirname(profile))) ||
      !inside(temporaryRoot, profile)) fail('QA012_RESUME_INVALID');
  const sourceHashes = Object.entries(previous.sourceHashes || {});
  const sourceChanges = [];
  if (!sourceHashes.length || sourceHashes.some(([file, digest]) => {
    const target = path.resolve(extensionRoot, file), rel = path.relative(extensionRoot, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(target)) return true;
    const current = hash(fs.readFileSync(target));
    if (current !== digest) sourceChanges.push({ file, previous: digest, current });
    return current !== digest && !verifyUpdatedSource;
  })) fail('QA012_RESUME_SOURCE_CHANGED');
  let stateFile = path.join(dir, 'failure-state.json'), state = JSON.parse(fs.readFileSync(stateFile));
  let failureStateSha256 = null;
  if (persistenceOnly && state.turns?.length === 0 && previous.phase?.name === 'waiting-cold-restoration') {
    failureStateSha256 = hash(fs.readFileSync(stateFile));
    stateFile = path.join(dir, 'before-cold-reopen.json');
    state = selectColdRestoreResumeExpectation(previous, state, JSON.parse(fs.readFileSync(stateFile)),
      JSON.parse(fs.readFileSync(path.join(dir, 'save-observation.json'))));
  }
  if (!Array.isArray(state.turns) || (persistenceOnly ? state.turns.length !== QUESTIONS.length :
      state.turns.length < 1 || state.turns.length >= QUESTIONS.length) ||
      state.turns.some((t, i) => t.status !== 'completed' || norm(t.question) !== norm(QUESTIONS[i])) ||
      !state.documentId || !state.documentHash) fail('QA012_RESUME_INVALID');
  const rejectLinks = folder => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail('QA012_RESUME_INVALID');
    if (entry.isDirectory()) rejectLinks(path.join(folder, entry.name));
  } }; rejectLinks(profile);
  return { profile, state, directory: dir, sourceChanges, stateFile: path.basename(stateFile), failureStateSha256,
    reportSha256: hash(bytes), stateSha256: hash(fs.readFileSync(stateFile)) };
}

export function persistedTurns(turns) {
  return turns.map(t => ({ turnId: t.turnId, question: t.question, status: t.status,
    answerBlocks: (t.answerBlocks || []).map(b => ({ blockId: b.blockId, markdown: b.markdown,
      evidence: (b.evidence || []).map(e => ({ marker: e.marker, paragraphId: e.paragraphId, sourceKey: e.sourceKey,
        textHash: e.textHash, quote: e.quote })) })) }));
}

function articleHtml(article) {
  let previous = '';
  const body = article.paragraphs.map(p => {
    const heading = p.section !== previous ? `<h2>${escapeHtml(p.section)}</h2>` : '';
    previous = p.section;
    return `${heading}<p id="${escapeHtml(p.id)}">${escapeHtml(p.text)}</p>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(article.title)}</title><link rel="canonical" href="${escapeHtml(article.url)}"></head><body><main><article><h1>${escapeHtml(article.title)}</h1>${body}</article></main></body></html>`;
}

function copyExtension(destination, source, proxyUrl, report) {
  fs.mkdirSync(destination, { recursive: true });
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(source, dir), path.join(destination, dir), { recursive: true });
  for (const file of fs.readdirSync(source)) if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(source, file), path.join(destination, file));
  // Hash all copied program files, not only a selected success path.
  const collect = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name); if (e.isDirectory()) collect(file);
    else if (/\.(js|mjs|html|css|json)$/u.test(file)) report.sourceHashes[path.relative(destination, file).replaceAll('\\', '/')] = hash(fs.readFileSync(file));
  } }; collect(destination);
  const worker = path.join(destination, 'offscreen-network-worker.js');
  const boundary = `const qa012Fetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(url,options={})=>{if(String(url)!==${JSON.stringify(ENDPOINT)})throw Error('QA012_REMOTE_BLOCKED');return qa012Fetch(${JSON.stringify(proxyUrl)},options);};\n`;
  fs.writeFileSync(worker, boundary + fs.readFileSync(worker, 'utf8'));
  report.temporaryWorkerSha256 = hash(fs.readFileSync(worker));
  report.dummyCredentialStoredInIsolatedProfile = true;
}

async function readRequest(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > MAX_BYTES) fail('QA012_REQUEST_TOO_LARGE'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArguments(argv), article = loadArticle(args.article); // Before any credential read or browser launch.
  const report = { taskId: 'QA-012', status: 'PREFLIGHT_PASS', model: MODEL, endpoint: ENDPOINT,
    source: article, sourceHashes: {}, realApiCalls: 0, providerCalls: [], turns: [], checks: [],
    retryObserved: false, coldReopened: false, scientificCompleteness: 'requires source and answer review; no fixed virus count',
    boundary: 'Real public-source paragraphs reconstructed as HTML; real production chain; isolated Edge/OPFS; transparent curl response, buffered stream; not original website extraction, native FSA, personal profile, or original 47-paragraph equivalence' };
  const extensionRoot = path.resolve(args.extensionRoot || root);
  const runtimeModule = { require: createRequire(path.join(extensionRoot, 'core/background-router.js')) };
  vm.runInNewContext(fs.readFileSync(path.join(extensionRoot, 'core/background-router.js'), 'utf8'), runtimeModule);
  const expectedRouterFactoryHash = hash(runtimeModule.SciLLM.createBackgroundRouter.toString());
  const resume = args.resumeRun ? loadResumeRun(args.resumeRun, article, extensionRoot,
    { persistenceOnly: args.persistenceOnly, verifyUpdatedSource: args.verifyUpdatedSource }) : null;
  report.persistenceOnly = args.persistenceOnly === true;
  if (args.preflightOnly) {
    if (args.outputDir) {
      fs.mkdirSync(path.resolve(args.outputDir), { recursive: true });
      report.output = fs.mkdtempSync(path.join(path.resolve(args.outputDir), 'preflight-'));
      fs.writeFileSync(path.join(report.output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    }
    return report;
  }
  const outputBase = path.resolve(args.outputDir || path.join(root, 'output/playwright/qa012-live-neuron'));
  fs.mkdirSync(outputBase, { recursive: true });
  const output = fs.mkdtempSync(path.join(outputBase, 'run-'));
  report.output = output;
  let credential;
  try { credential = await loadCredential(args); }
  catch (error) { report.status = 'FAIL'; report.errorCode = safeCode(error);
    fs.writeFileSync(path.join(output, 'report.json'), sanitizedReplay(JSON.stringify(report))); return report; }
  report.credential = credential.metadata;
  let secret = credential.secret;
  const controller = new AbortController(), deadline = Date.now() + args.deadlineMs;
  const timer = setTimeout(() => controller.abort(), args.deadlineMs);
  const remaining = () => { if (controller.signal.aborted || Date.now() >= deadline) fail('QA012_DEADLINE'); return deadline - Date.now(); };
  const bounded = async work => {
    remaining(); let listener;
    const expiry = new Promise((_, reject) => { listener = () => reject(Object.assign(new Error('QA012_DEADLINE'), { code: 'QA012_DEADLINE' })); controller.signal.addEventListener('abort', listener, { once: true }); });
    try { return await Promise.race([Promise.resolve().then(work), expiry]); }
    finally { controller.signal.removeEventListener('abort', listener); }
  };
  const write = (name, value) => {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    if (secret) text = text.split(secret).join('[REDACTED_SECRET]');
    fs.writeFileSync(path.join(output, name), sanitizedReplay(text));
  };
  const persist = () => write('report.json', report);
  const phase = (name, details = {}) => {
    report.phase = { name, at: new Date().toISOString(), ...details }; persist();
  };
  const dummy = `qa012-local-${crypto.randomBytes(24).toString('hex')}`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-qa012-live-'));
  const profile = path.join(temporary, 'profile'), extension = path.join(temporary, 'extension');
  if (resume) {
    fs.cpSync(resume.profile, profile, { recursive: true, errorOnExist: true, force: false });
    report.resume = { sourceRun: resume.directory, sourceReportSha256: resume.reportSha256,
      sourceStateSha256: resume.stateSha256, reusedTurns: resume.state.turns.length,
      expectedStateFile: resume.stateFile, failureStateSha256: resume.failureStateSha256,
      sourceChanges: resume.sourceChanges,
      boundary: 'Copy of this harness own closed isolated profile; prior real answers retained, no replayed or invented provider response' };
  }
  report.isolatedProfile = profile; // Retained for review; contains only dummy credential and this public article.
  let context, panel, paper, worker, server, tabId, pendingLaunch, allowProviderCalls = !args.persistenceOnly;
  const runtimeErrors = [];
  controller.signal.addEventListener('abort', () => { context?.close().catch(() => {}); }, { once: true });
  const forwarder = createForwarder({ article, secret, callCap: args.callCap, timeoutMs: args.providerTimeoutMs, signal: controller.signal,
    record: (entry, artifacts) => { report.realApiCalls = forwarder.calls; report.providerCalls[entry.sequence - 1] = entry;
      for (const [kind, text] of Object.entries(artifacts)) write(`provider-${entry.sequence}-${kind}-redacted.json`, text); persist(); } });
  const screenshot = async name => { await panel.screenshot({ path: path.join(output, name), fullPage: true, timeout: Math.min(remaining(), 15000) }); };
  const snapshot = async () => ({ ...await panel.evaluate(() => ({
    workspaceId: currentWorkspaceSnapshot?.workspaceId, coverage: currentWorkspaceSnapshot?.chat?.coverage,
    turns: currentWorkspaceSnapshot?.chat?.turns || [], loading: currentWorkspaceSnapshot?.chat?.loading,
    documentId: currentWorkspaceSnapshot?.documentId, documentHash: currentWorkspaceSnapshot?.documentHash })),
    // The popup summary truncates paragraphs to 4000 chars. Read the actual canonical
    // input through its existing getter; never substitute a source or verification result.
    paragraphs: await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId },
      func: () => getCanonicalArticleSnapshot({ forceRefresh: false }).paragraphs }))[0].result, tabId) });
  const waitTurn = async (count, priorUpdatedAt = 0) => {
    await panel.waitForFunction(({ count, priorUpdatedAt }) => {
      const chat = currentWorkspaceSnapshot?.chat, turn = chat?.turns?.at(-1);
      return chat?.turns?.length === count && chat.loading !== true &&
        ['completed', 'error', 'failed', 'incomplete', 'truncated', 'cancelled', 'interrupted'].includes(turn?.status) &&
        (!priorUpdatedAt || Number(turn.updatedAt) > priorUpdatedAt);
    }, { count, priorUpdatedAt }, { timeout: Math.min(remaining(), args.providerTimeoutMs * 3 + 60000) });
    return snapshot();
  };
  let expectedReopenState = null;
  const launch = async cold => {
    const { chromium } = await import('playwright');
    pendingLaunch = chromium.launchPersistentContext(profile, { channel: 'msedge', headless: !args.headed,
      viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', timeout: Math.min(remaining(), 60000),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    context = await pendingLaunch; pendingLaunch = null;
    if (controller.signal.aborted) { await context.close(); fail('QA012_DEADLINE'); }
    context.setDefaultTimeout(Math.min(remaining(), 30000));
    await context.addInitScript(() => {
      if (!location.pathname.endsWith('/popup.html')) return;
      globalThis.qa012RestoreTrace = [];
      const record = value => { if (qa012RestoreTrace.length < 160) qa012RestoreTrace.push({ at: Date.now(), ...value }); };
      document.addEventListener('DOMContentLoaded', () => {
        for (const name of ['initializeCurrentArticle', 'tryAutoRestoreCurrentArticleWorkspace',
          'restoreCurrentArticleWorkspaceFromDirectory', 'sendLlmMessage', 'sendTabMessage']) {
          const original = globalThis[name];
          if (typeof original !== 'function') { record({ name, missing: true }); continue; }
          globalThis[name] = async function(...args) {
            const message = name === 'sendLlmMessage' ? args[0] : name === 'sendTabMessage' ? args[1] : {};
            const action = message?.type || message?.action || '';
            if (action && !/WORKSPACE|ArticleWorkspace|ArticleArchive|DOCUMENT_PREPARE|USER_DATA_SYNC_NOW|PORTABLE_CONFIG/iu.test(action)) return original.apply(this, args);
            record({ name, action, phase: 'start' });
            try {
              const result = await original.apply(this, args);
              record({ name, action, phase: 'end', success: result?.success, code: result?.code,
                error: result?.error, permission: result?.permission, returnedNull: result === null,
                restoreMatch: result?.restore?.match, workspace: result?.workspace,
                applied: result?.applied && { success: result.applied.success, committed: result.applied.committed,
                  code: result.applied.code, error: result.applied.error, chatTurns: result.applied.chatTurns, postCommitStatus: result.applied.postCommitStatus } });
              return result;
            } catch (error) { record({ name, action, phase: 'throw', code: error?.code, error: String(error?.message || error).slice(0, 500) }); throw error; }
          };
        }
      }, { once: true });
    });
    await context.route(/^https?:\/\//u, async route => {
      const url = route.request().url();
      if (url === article.url) return route.fulfill({ contentType: 'text/html', body: articleHtml(article) });
      if (url === proxyUrl) return route.continue();
      return route.abort('blockedbyclient');
    });
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const runtimeHash = async () => hash(await worker.evaluate(() => SciLLM.createBackgroundRouter.toString()));
    const beforeRuntime = await runtimeHash();
    let reloaded = false;
    if (beforeRuntime !== expectedRouterFactoryHash) {
      const restarted = context.waitForEvent('serviceworker', { timeout: Math.min(remaining(), 30000) });
      await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
      worker = await restarted; reloaded = true;
    }
    const actualRuntime = await runtimeHash();
    (report.runtimeChecks ||= []).push({ cold, before: beforeRuntime, expected: expectedRouterFactoryHash,
      actual: actualRuntime, reloaded });
    if (actualRuntime !== expectedRouterFactoryHash) fail('QA012_RUNTIME_SOURCE_MISMATCH');
    if (!cold && !args.persistenceOnly) {
      const directory = await worker.evaluate(async () => {
        const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle('qa012-live-source', { create: true });
        await SciLLM.createIndexedDbDirectoryHandleStore(indexedDB).save(handle);
        return directorySync.status();
      });
      assert.equal(directory.permission, 'granted');
    }
    paper = context.pages().find(p => p.url() === article.url) || await context.newPage();
    await paper.goto(article.url, { waitUntil: 'domcontentloaded' });
    const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url), article.url);
    tabId = tab.id;
    await worker.evaluate(async tab => {
      const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
      await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
    }, tab);
    panel = await context.newPage(); await panel.setViewportSize({ width: 620, height: 1000 });
    panel.on('pageerror', error => runtimeErrors.push({ surface: 'popup', name: error.name, message: String(error.message).slice(0, 500) }));
    panel.on('console', message => { if (['error', 'warning'].includes(message.type()) && runtimeErrors.length < 40)
      runtimeErrors.push({ surface: 'popup-console', type: message.type(), message: message.text().slice(0, 500) }); });
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`, { waitUntil: 'domcontentloaded' });
    await paper.bringToFront();
    await panel.waitForFunction(title => document.getElementById('sidePanelPaperTitle')?.textContent === title, article.title);
    // The title is set before directory auto-restore applies saved turns. Do not
    // change profile/selection while that production restore is still in flight.
    const expectedRestore = cold ? expectedReopenState : resume?.state;
    if (expectedRestore) {
      phase(cold ? 'waiting-cold-restoration' : 'waiting-resume-restoration');
      try { await panel.waitForFunction(({ documentId, documentHash, turnIds }) => {
        const state = currentWorkspaceSnapshot, turns = state?.chat?.turns || [];
        return state?.documentId === documentId && state?.documentHash === documentHash &&
          state?.chat?.loading !== true && turns.length === turnIds.length &&
          turns.every((turn, i) => turn.turnId === turnIds[i] && turn.status === 'completed');
      }, { documentId: expectedRestore.documentId, documentHash: expectedRestore.documentHash,
        turnIds: expectedRestore.turns.map(turn => turn.turnId) }, { timeout: Math.min(remaining(), 30000) }); }
      catch (error) {
        if (error.name === 'TimeoutError') fail(cold ? 'QA012_COLD_RESTORE_TIMEOUT' : 'QA012_RESUME_RESTORE_TIMEOUT');
        throw error;
      }
      const restoredTurns = await panel.evaluate(() => currentWorkspaceSnapshot.chat.turns);
      assert.deepEqual(persistedTurns(restoredTurns), persistedTurns(expectedRestore.turns),
        'restoration must deliver the exact persisted answers before any test interaction');
      report.restorationReadiness = { kind: cold ? 'cold-reopen' : 'resume',
        turns: restoredTurns.length, exactPersistedAnswers: true, at: new Date().toISOString() };
      persist();
    }
    if (!cold && !args.persistenceOnly) await panel.evaluate(async ({ model, dummy }) => {
      for (const message of [
        { type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_qa012_live', name: 'QA012 live', providerId: 'deepseek', config: { apiKey: dummy, model, maxOutputTokens: 16384, reasoningEnabled: false } } },
        { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_qa012_live', taskRoutes: {} },
        { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
      ]) { const response = await chrome.runtime.sendMessage(message); if (!response?.success) throw Error('QA012_PROFILE_SETUP_FAILED'); }
      await loadLlmSettings(); await refreshArticleWorkspace();
    }, { model: MODEL, dummy });
    await panel.locator('#workspace-tab-chat').click();
    if (!cold && !args.persistenceOnly) {
      await panel.locator('#articleChatProfile').selectOption('profile_qa012_live');
      if (await panel.locator('#articleChatWebSearch').getAttribute('aria-pressed') === 'true') await panel.locator('#articleChatWebSearch').click();
    }
  };
  let proxyUrl;
  try {
    report.status = 'RUNNING'; persist();
    server = http.createServer(async (request, reply) => {
      reply.setHeader('Access-Control-Allow-Origin', '*'); reply.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
      if (request.method === 'OPTIONS') { reply.writeHead(204); reply.end(); return; }
      try {
        if (request.method !== 'POST' || request.url !== '/chat/completions' || request.headers.authorization !== `Bearer ${dummy}`) fail('QA012_PROXY_REJECTED');
        if (!allowProviderCalls) fail('QA012_REOPEN_PROVIDER_CALL_BLOCKED');
        const requestBody = await readRequest(request);
        // Preserve rejected public requests too, so a verifier boundary failure
        // can be diagnosed offline without another paid model attempt.
        write(`boundary-request-${(report.boundaryRequestCount = (report.boundaryRequestCount || 0) + 1)}.json`, requestBody);
        const result = await forwarder.forward(requestBody);
        reply.writeHead(result.status, { 'Content-Type': result.contentType }); reply.end(result.bytes);
      } catch (error) { (report.boundaryErrors ||= []).push({ code: safeCode(error), at: new Date().toISOString() }); persist();
        if (!reply.headersSent) reply.writeHead(502, { 'Content-Type': 'application/json' }); reply.end(JSON.stringify({ error: { code: safeCode(error) } })); }
    });
    await bounded(() => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }));
    proxyUrl = `http://127.0.0.1:${server.address().port}/chat/completions`;
    copyExtension(extension, extensionRoot, proxyUrl, report);
    phase('launching-isolated-browser');
    await bounded(() => launch(false));
    // Actual navigation checkboxes select every section without relabelling Methods.
    await panel.locator('#workspace-tab-navigation').click();
    phase('selecting-source-sections');
    for (let attempts = 0; attempts < article.paragraphs.length + 20; attempts++) {
      const unchecked = panel.locator('.workspace-section-analysis-toggle:not(:checked):not(:disabled)').first();
      if (!await unchecked.count()) break;
      const label = await unchecked.getAttribute('aria-label');
      await unchecked.check();
      await panel.waitForFunction(label => [...document.querySelectorAll('.workspace-section-analysis-toggle')]
        .some(e => e.getAttribute('aria-label') === label && e.checked && !e.disabled), label);
      if (attempts % 10 === 0) phase('selecting-source-sections', { selected: attempts + 1 });
    }
    const initial = await snapshot();
    if (await panel.locator('.workspace-section-analysis-toggle:not(:checked):not(:disabled)').count()) fail('QA012_SECTION_SELECTION_INCOMPLETE');
    if (!article.paragraphs.every(p => initial.paragraphs.some(live => norm(live.text).includes(norm(p.text))))) fail('QA012_RENDERED_SOURCE_INCOMPLETE');
    if (!initial.documentHash || !initial.documentId) fail('QA012_RENDERED_SOURCE_IDENTITY');
    article.runtimeDocumentHash = initial.documentHash;
    report.extractedParagraphCount = initial.paragraphs.length; report.user47ParagraphEquivalence = false;
    await panel.locator('#workspace-tab-chat').click();
    if (resume) {
      assert.equal(initial.documentId, resume.state.documentId);
      assert.equal(initial.documentHash, resume.state.documentHash);
      assert.deepEqual(persistedTurns(initial.turns), persistedTurns(resume.state.turns));
      for (let index = 0; index < initial.turns.length; index++) {
        const summary = inspectTurn(initial.turns[index], initial.paragraphs, index === 3, { collectKnownMissing: true });
        report.turns.push({ ...summary, reusedFromRun: resume.directory });
        write(`turn-${index + 1}-restored.json`, initial);
      }
    } else if (initial.turns.length) fail('QA012_UNEXPECTED_PRIOR_TURNS');
    for (let index = report.turns.length; index < QUESTIONS.length; index++) {
      remaining();
      const beforeCalls = forwarder.calls;
      phase('asking', { turn: index + 1 });
      await panel.locator('#articleChatQuestion').fill(QUESTIONS[index]); await panel.locator('#sendArticleChat').click();
      let state = await bounded(() => waitTurn(index + 1)), turn = state.turns.at(-1);
      write(`turn-${index + 1}-first-result.json`, state);
      if (turn.status !== 'completed') {
        if (report.boundaryErrors?.some(e => /^QA012_(?:REQUEST|SENT_COVERAGE)/u.test(e.code))) {
          fail(report.boundaryErrors.find(e => /^QA012_(?:REQUEST|SENT_COVERAGE)/u.test(e.code)).code);
        }
        const element = panel.locator('.article-chat-turn').nth(index);
        await element.scrollIntoViewIfNeeded();
        const actions = element.locator('.article-chat-turn-actions');
        const visible = await actions.evaluate(e => ({ opacity: getComputedStyle(e).opacity, height: e.getBoundingClientRect().height }));
        report.failureActions = { visible, regenerateEnabled: await element.locator('[data-article-chat-action="regenerate"]').isEnabled(),
          deleteEnabled: await element.locator('[data-article-chat-action="delete-turn"]').isEnabled() };
        await screenshot(`turn-${index + 1}-failure.png`); persist();
        if (!args.retryFailedOnce) fail('QA012_REAL_TURN_FAILED');
        if (Number(visible.opacity) < .9 || !report.failureActions.regenerateEnabled || !report.failureActions.deleteEnabled) fail('QA012_FAILURE_ACTIONS');
        const id = turn.turnId, priorUpdatedAt = Number(turn.updatedAt); report.retryObserved = true;
        // One actual UI regeneration per turn: a different turn's transport failure
        // must not consume this opportunity. The run retains its explicit API cap.
        (report.regenerations ||= []).push({ turn: index + 1, turnId: id,
          originalStatus: turn.status, providerCallsBefore: forwarder.calls });
        persist();
        await element.locator('[data-article-chat-action="regenerate"]').click();
        state = await bounded(() => waitTurn(index + 1, priorUpdatedAt)); turn = state.turns.at(-1);
        assert.equal(turn.turnId, id);
      }
      const summary = inspectTurn(turn, state.paragraphs, index === 3, { collectKnownMissing: true });
      if (forwarder.calls <= beforeCalls) fail('QA012_NO_REAL_REQUEST');
      summary.providerSequences = report.providerCalls.slice(beforeCalls).map(call => call.sequence);
      summary.coverage = state.coverage;
      const element = panel.locator('.article-chat-turn').nth(index); await element.scrollIntoViewIfNeeded();
      await element.locator('.article-chat-answer-block').first().waitFor({ state: 'visible' });
      summary.renderedRows = await element.locator('table tbody tr').count();
      if (index === 3 && summary.renderedRows !== summary.tableRows) fail('QA012_TABLE_RENDER_MISMATCH');
      report.turns.push(summary); write(`turn-${index + 1}-accepted.json`, state); await screenshot(`turn-${index + 1}.png`); persist();
    }
    phase('saving');
    const before = await snapshot();
    const portable = await panel.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: 'PORTABLE_CONFIG_PROBE' });
      return { success: response?.success, state: response?.data?.state, pending: response?.data?.pending };
    });
    report.portableBeforePreparation = portable;
    if (!portable.success) fail('QA012_PORTABLE_PROBE_FAILED');
    if (portable.state === 'missing') {
      // Normal setup in this harness's own isolated profile, using dummy settings.
      // Never replace an existing encrypted config or persist this random password.
      report.portablePreparation = await panel.evaluate(async passphrase => {
        const response = await chrome.runtime.sendMessage({ type: 'PORTABLE_CONFIG_CREATE', passphrase });
        return { success: response?.success, state: response?.data?.state, pending: response?.data?.pending };
      }, crypto.randomBytes(32).toString('hex'));
      if (!report.portablePreparation.success || report.portablePreparation.state !== 'ready' ||
          report.portablePreparation.pending) fail('QA012_PORTABLE_SETUP_FAILED');
    } else if (portable.state !== 'ready' || portable.pending) fail('QA012_PORTABLE_NOT_READY');
    const ensured = await panel.evaluate(() => sendTabMessage(activePanelTabContext.tabId, { action: 'ensureArticleWorkspace' }));
    if (!ensured?.success || !ensured.workspace) fail('QA012_SAVE_IDENTITY');
    await panel.locator('#saveCurrentArticleWorkspace').click();
    await panel.waitForFunction(() => !articleWorkspaceSaveGuard.isPending());
    const status = await worker.evaluate(async identity => { const flushed = await directorySync.flush(); return {
      flushed, status: await directorySync.status(), chat: await directorySync.readWorkspaceAsset(identity, 'chat/index.json') }; }, ensured.workspace);
    if (status.flushed.failed || status.status.pendingCount || status.status.permission !== 'granted') fail('QA012_SAVE_NOT_DURABLE');
    assert.deepEqual(persistedTurns(status.chat?.value?.data?.turns || []), persistedTurns(before.turns));
    const saveUi = await panel.locator('#statusMessage').textContent();
    report.saveDirectory = { flushed: status.flushed, status: status.status, exactChatPersisted: true, saveUi };
    write('save-observation.json', report.saveDirectory); persist();
    write('save-runtime-trace.json', { trace: await panel.evaluate(() => globalThis.qa012RestoreTrace || []), runtimeErrors });
    if (!hasConfirmedDirectorySave(saveUi)) fail('QA012_SAVE_UI_NOT_CONFIRMED');
    write('before-cold-reopen.json', before);
    allowProviderCalls = false;
    await bounded(() => context.close()); context = null; panel = null;
    phase('cold-reopening');
    expectedReopenState = before;
    await bounded(() => launch(true));
    await bounded(() => waitTurn(4));
    const after = await snapshot();
    assert.deepEqual(persistedTurns(after.turns), persistedTurns(before.turns));
    if (!after.documentId || after.documentId !== before.documentId || !after.documentHash || after.documentHash !== before.documentHash) fail('QA012_REOPEN_IDENTITY');
    for (let i = 0; i < after.turns.length; i++) inspectTurn(after.turns[i], after.paragraphs, i === 3, { collectKnownMissing: true });
    const finalTurn = panel.locator('.article-chat-turn').nth(3); await finalTurn.scrollIntoViewIfNeeded();
    assert.equal(await finalTurn.locator('table tbody tr').count(), report.turns[3].tableRows);
    assert.equal(await panel.locator('#sendArticleChat').isEnabled(), true);
    assert.equal(await finalTurn.locator('[data-article-chat-action="regenerate"]').isEnabled(), true);
    assert.equal(await finalTurn.locator('[data-article-chat-action="delete-turn"]').isEnabled(), true);
    write('after-cold-reopen.json', after); await screenshot('cold-reopened.png');
    report.coldReopened = true;
    if (report.boundaryErrors?.some(e => e.code === 'QA012_REOPEN_PROVIDER_CALL_BLOCKED')) fail('QA012_REOPEN_UNEXPECTED_REQUEST');
    report.flowStatus = 'PASS';
    report.citationIssues = report.turns.flatMap(t => t.citationIssues.map(issue => ({ turnId: t.turnId, ...issue })));
    report.citationStatus = report.citationIssues.length ? 'NEEDS_REVIEW' : 'PASS';
    report.status = report.citationIssues.length ? 'FAIL' : 'PASS';
    if (report.citationIssues.length) report.errorCode = 'QA012_CITATION_BINDING';
  } catch (error) {
    report.status = 'FAIL'; report.errorCode = safeCode(error);
    report.failure = { phase: report.phase?.name, name: error?.name, code: error?.code,
      message: String(error?.message || error).slice(0, 700), runtimeErrors };
    if (panel && !panel.isClosed()) {
      await snapshot().then(s => write('failure-state.json', s)).catch(() => {});
      const observed = await panel.evaluate(() => ({ trace: globalThis.qa012RestoreTrace || [],
        status: document.getElementById('statusMessage')?.textContent,
        title: document.getElementById('sidePanelPaperTitle')?.textContent,
        existingResults: typeof workspaceAlreadyHasArticleResults === 'function' ? workspaceAlreadyHasArticleResults() : null,
        manualCount: typeof manualAnnotationState === 'undefined' ? null : manualAnnotationState?.annotationCount,
        highlights: currentWorkspaceSnapshot?.highlightDistribution?.totalHighlights,
        chat: { turns: currentWorkspaceSnapshot?.chat?.turns?.length, totalTurns: currentWorkspaceSnapshot?.chat?.totalTurns, loading: currentWorkspaceSnapshot?.chat?.loading },
        documentId: currentWorkspaceSnapshot?.documentId, documentHash: currentWorkspaceSnapshot?.documentHash,
        archivePrompt: { hidden: document.getElementById('articleArchivePrompt')?.hidden, summary: document.getElementById('articleArchivePromptSummary')?.textContent }
      })).catch(captureError => ({ captureError: String(captureError.message).slice(0, 300) }));
      const directory = await worker.evaluate(async () => {
        const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
        const diff = (left, right, prefix = '') => {
          if (stable(left) === stable(right)) return [];
          if (left && right && typeof left === 'object' && typeof right === 'object') {
            return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => diff(left[key], right[key], `${prefix}/${key}`)).slice(0, 40);
          }
          const brief = value => value === undefined ? { present: false } : { present: true, type: typeof value,
            ...(typeof value === 'string' ? { length: value.length, sample: value.slice(0, 120) } : { value }) };
          return [{ path: prefix, local: brief(left), directory: brief(right) }];
        };
        const workspaces = await articleWorkspaceStore.listWorkspaces();
        return { status: await directorySync.status(), workspaces: await Promise.all(workspaces.map(async workspace => {
          const identity = { workspaceId: workspace.workspaceId, workspaceGeneration: workspace.workspaceGeneration,
            documentId: workspace.documentId, canonicalUrl: workspace.canonicalUrl, directoryName: workspace.directoryName };
          try { const disk = await directorySync.readWorkspaceAsset(workspace, 'chat/index.json');
            const turns = disk?.value?.data?.turns || [];
            const localAssets = await articleWorkspaceStore.listAssets(workspace.workspaceId);
            const comparisons = await Promise.all(localAssets.map(async asset => {
              const other = await directorySync.readWorkspaceAsset(workspace, asset.relativePath);
              return { path: asset.relativePath, localRevision: asset.revision, directoryRevision: other.value?.revision,
                found: other.found, differences: other.found ? diff(asset.content, other.value.data) : [] };
            }));
            const localTurns = await articleWorkspaceStore.pageTurns(workspace.workspaceId, { limit: 1000, afterSequence: 0 });
            const diskChat = await directorySync.listWorkspaceChatAssets(workspace);
            const standalone = (diskChat.assets || []).filter(asset => /^chat\/turns\//u.test(asset.relativePath));
            return { identity, disk: { permission: disk.permission, found: disk.found, turnIds: turns.map(t => t.turnId), statuses: turns.map(t => t.status) },
              standalone: { invalidAssets: diskChat.invalidAssets, turns: standalone.map(asset => ({ path: asset.relativePath,
                turnId: asset.content?.turnId, status: asset.content?.status, operationId: asset.content?.operationId,
                revision: asset.revision, updatedAt: asset.updatedAt,
                vsIndex: diff(asset.content, turns.find(t => t.turnId === asset.content?.turnId)),
                vsLocal: diff(asset.content, (localTurns.items || []).find(t => t.turnId === asset.content?.turnId)) })) },
              assetComparisons: comparisons, localTurns: { hasMore: localTurns.hasMore, turns: (localTurns.items || []).map(t => ({ turnId: t.turnId,
                differences: diff(t, turns.find(d => d.turnId === t.turnId)) })) } };
          } catch (readError) { return { identity, error: { code: readError.code, message: String(readError.message).slice(0, 500) } }; }
        })) };
      }).catch(captureError => ({ captureError: String(captureError.message).slice(0, 300) }));
      write('restoration-diagnostic.json', { observed, directory, runtimeErrors });
      await screenshot('failure.png').catch(() => {});
    }
  } finally {
    controller.abort(); clearTimeout(timer);
    if (pendingLaunch) {
      report.browserLaunchCleanupPending = true;
      pendingLaunch.then(browser => browser.close()).catch(() => {});
    }
    if (context) {
      let closeTimer;
      report.browserClosed = await Promise.race([context.close().then(() => true, () => false),
        new Promise(resolve => { closeTimer = setTimeout(() => resolve(false), 10000); })]);
      clearTimeout(closeTimer);
      if (!report.browserClosed && report.status === 'PASS') { report.status = 'FAIL'; report.errorCode = 'QA012_BROWSER_CLOSE_TIMEOUT'; }
    }
    server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
    report.realApiCalls = forwarder.calls;
    report.sourceFilesUnchanged = Object.entries(report.sourceHashes).every(([file, digest]) => hash(fs.readFileSync(path.join(extensionRoot, file))) === digest);
    report.articleFileUnchanged = hash(fs.readFileSync(args.article)) === article.sourceSha256;
    if (!report.sourceFilesUnchanged || !report.articleFileUnchanged) { report.status = 'FAIL'; report.errorCode = 'QA012_SOURCE_CHANGED'; }
    persist(); secret = '';
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then(report => { console.log(JSON.stringify({ status: report.status, output: report.output, realApiCalls: report.realApiCalls,
    coldReopened: report.coldReopened, errorCode: report.errorCode, paragraphs: report.source.paragraphs.length }));
    if (report.status === 'FAIL') process.exitCode = 1;
  }).catch(error => { console.error(safeCode(error)); process.exitCode = 1; });
}
