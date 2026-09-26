// NOTE016 acceptance only. Original downloaded HTML, production canonical
// extraction and popup handlers. No credentials or real requests without --execute-live.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadProduction, inspectReopenedNoteState, assertReopenedNoteState, inspectStructure as inspectLegacyStructure } from './verify-note011-live-structure.mjs';
import { loadLivePortableProfile } from './lib/live-portable-profile.mjs';
import { createCurlFetch } from './lib/live-curl-fetch.mjs';
import { sanitizedReplay } from './verify-live-web-chat-extension.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARTICLE_URL = 'https://www.nature.com/articles/s41586-025-09984-y';
export const ARTICLE_TITLE = 'Intestinal macrophages modulate synucleinopathy along the gut–brain axis';
export const MODEL = 'deepseek-flash';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const RESULT_SECTIONS = ['ME-Macs engulf and modify αS pathology', 'A gut-to-brain T cell axis in PD',
  'ME-Mac–T cell crosstalk through TGFβ1', 'ME-Mac targeting reduces PD pathology'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const norm = value => String(value || '').normalize('NFKC').replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const safeCode = error => /^[A-Z][A-Z0-9_]{2,80}$/u.test(error?.code || '') ? error.code : 'NOTE016_ACCEPTANCE_FAILED';

export function parseArguments(argv) {
  const args = { html: path.join(root, 'output/note016-nature-source-20260925/nature-live.html'),
    extensionRoot: root, callCap: 4, deadlineMs: 900000, providerTimeoutMs: 180000, executeLive: false };
  const values = new Set(['html', 'extension-root', 'output-dir', 'portable-config', 'profile', 'config-sha256',
    'config-revision', 'call-cap', 'deadline-ms', 'provider-timeout-ms']);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) fail('NOTE016_ARGUMENT_INVALID');
    if (['--execute-live', '--preflight-only', '--headed', '--single-followup'].includes(argv[i])) {
      args[argv[i].slice(2).replace(/-([a-z])/gu, (_, c) => c.toUpperCase())] = true; continue;
    }
    const name = argv[i].slice(2), value = argv[++i];
    if (!values.has(name) || !value || value.startsWith('--')) fail('NOTE016_ARGUMENT_INVALID');
    args[name.replace(/-([a-z])/gu, (_, c) => c.toUpperCase())] = value;
  }
  if (args.executeLive && args.preflightOnly) fail('NOTE016_ARGUMENT_INVALID');
  for (const [key, min, max] of [['callCap', 1, 5], ['deadlineMs', 10000, 1200000], ['providerTimeoutMs', 1000, 180000]]) {
    args[key] = Number(args[key]); if (!Number.isSafeInteger(args[key]) || args[key] < min || args[key] > max) fail('NOTE016_ARGUMENT_INVALID');
  }
  if (args.executeLive && (!args.portableConfig || args.profile !== 'DS' ||
    !/^[a-f0-9]{64}$/u.test(args.configSha256 || '') || Number(args.configRevision) !== 50)) fail('NOTE016_PROFILE_REQUIRED');
  return args;
}

export function figureLabelAtStart(text) {
  const value = norm(text);
  const extended = value.match(/^(Extended Data (?:Fig\.?|Figure)\s+([1-9]\d{0,2}))(?:\s*[:：]|\.(?=\s|$)|\s+(?!and\b|to\b|[a-z](?=\s*(?:[),;:.–—/&-]|and\b|to\b|$)))(?=\p{L}))/iu);
  if (extended) return { id: `ED${extended[2]}`, label: extended[1] };
  const main = value.match(/^((?:Fig\.?|Figure)\s+([1-9]\d{0,2}))(?:\s*[:：]|\.(?=\s|$))/iu);
  return main ? { id: main[2], label: main[1] } : null;
}

export function inspectCanonical(canonical) {
  if (canonical?.url !== ARTICLE_URL || !norm(canonical.title).startsWith(norm(ARTICLE_TITLE)) ||
    !canonical.documentHash || !Array.isArray(canonical.paragraphs) || !Array.isArray(canonical.typedRecords)) fail('NOTE016_SOURCE_IDENTITY');
  const captions = canonical.typedRecords.filter(r => r.recordType === 'figure-caption');
  const results = canonical.paragraphs.filter(p => p.sectionKind === 'main' && RESULT_SECTIONS.some(title => norm(title) === norm(p.sectionTitle)));
  const ids = new Set(), labelIds = new Set();
  const captionSummary = captions.map(r => {
    if (!r.paragraphId || !r.sourceKey || !r.textHash || ids.has(r.paragraphId)) fail('NOTE016_CAPTION_IDENTITY');
    ids.add(r.paragraphId); const label = figureLabelAtStart(r.text);
    if (label && labelIds.has(label.id)) fail('NOTE016_CAPTION_LABEL_AMBIGUOUS');
    if (label) labelIds.add(label.id);
    return { paragraphId: r.paragraphId, sourceKey: r.sourceKey, textHash: r.textHash,
      originalSectionKind: r.sectionKind, label, characters: r.text.length, prefix: r.text.slice(0, 180) };
  });
  const expected = ['1','2','3','4','5',...Array.from({ length: 8 }, (_, i) => `ED${i + 1}`)];
  const domCaptions = canonical.diagnostics?.sourceCaptionDom || [];
  const incompleteDescriptions = expected.filter(id => {
    const dom = domCaptions.filter(d => d.label?.id === id), typed = captions.filter(c => figureLabelAtStart(c.text)?.id === id);
    return dom.length !== 1 || !norm(dom[0].description) || typed.length !== 1 ||
      !norm(typed[0].text).includes(norm(dom[0].description));
  });
  return { paragraphCount: canonical.paragraphs.length, resultParagraphCount: results.length,
    resultParagraphIds: results.map(p => p.paragraphId), typedCaptionCount: captions.length,
    mainCaptionCount: captionSummary.filter(c => c.label && !c.label.id.startsWith('ED')).length,
    extendedDataCaptionCount: captionSummary.filter(c => c.label?.id.startsWith('ED')).length,
    missingLabels: expected.filter(id => !labelIds.has(id)), incompleteDescriptions, captions: captionSummary,
    ready: results.length === 11 && captions.length === 13 && expected.every(id => labelIds.has(id)) && !incompleteDescriptions.length };
}

export function inspectRequest(body, canonical, api) {
  const source = inspectCanonical(canonical);
  if (!source.ready) fail('NOTE016_SOURCE_NOT_READY');
  if (body?.model !== MODEL || body.stream === true || !Array.isArray(body.messages) ||
    !Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 12288) fail('NOTE016_REQUEST_INVALID');
  const users = body.messages.filter(m => m.role === 'user');
  if (users.length !== 1 || typeof users[0].content !== 'string') fail('NOTE016_REQUEST_INVALID');
  const text = users[0].content, delimiter = '\nLITERATURE_NOTE_REQUEST:\n', split = text.lastIndexOf(delimiter);
  if (split < 0) fail('NOTE016_REQUEST_INVALID');
  let payload; try { payload = JSON.parse(text.slice(split + delimiter.length)); } catch { fail('NOTE016_REQUEST_INVALID'); }
  const template = api.normalizeLiteratureNoteTemplates()[0], requested = payload.template?.fields?.map(f => f.id);
  if (requested?.length === 1 && requested[0] === 'main_findings') template.fields = template.fields.filter(f => f.id === 'main_findings');
  if (payload.task !== 'fill_literature_note' || payload.outputLanguage !== 'zh-CN' ||
    payload.template?.id !== template.id || JSON.stringify(requested) !== JSON.stringify(template.fields.map(f => f.id))) fail('NOTE016_REQUEST_IDENTITY');
  const rows = text.slice(0, split).split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const records = rows.filter(r => r.paragraphId), title = rows.find(r => r.documentTitle)?.documentTitle;
  if (norm(title) !== norm(canonical.title) || !records.length || rows.map(r => JSON.stringify(r)).join('\n').length > 128000) fail('NOTE016_REQUEST_IDENTITY');
  const corpus = [...canonical.paragraphs, ...canonical.typedRecords.filter(r => r.recordType === 'figure-caption')], ids = new Set();
  for (const r of records) {
    const matches = corpus.filter(p => p.paragraphId === r.paragraphId && p.sourceKey === r.sourceKey && p.textHash === r.textHash &&
      (p.sourceIdentity || p.sourceKey || p.paragraphId) === r.sourceIdentity && norm(p.text).startsWith(norm(r.text)));
    if (!r.paragraphId || ids.has(r.paragraphId) || r.documentHash !== canonical.documentHash || matches.length !== 1 || !norm(r.text)) fail('NOTE016_SOURCE_BINDING');
    if (matches[0].sectionKind === 'main' && matches[0].recordType !== 'figure-caption' && r.sectionKind !== 'main') fail('NOTE016_MAIN_RELABELLED');
    ids.add(r.paragraphId);
  }
  const captions = canonical.typedRecords.filter(r => r.recordType === 'figure-caption');
  const completeIds = captions.filter(c => records.some(r => r.paragraphId === c.paragraphId && norm(r.text) === norm(c.text))).map(c => c.paragraphId);
  const completeResults = source.resultParagraphIds.filter(id => {
    const original = canonical.paragraphs.find(p => p.paragraphId === id), record = records.find(p => p.paragraphId === id);
    return record && norm(record.text) === norm(original.text);
  });
  if (completeIds.length !== 13 || completeResults.length !== 11) fail('NOTE016_OUTBOUND_COVERAGE_INCOMPLETE');
  const policy = api.resolveLiteratureNoteEvidencePolicy(template, { sourceKind: 'html-canonical' });
  const document = { sourceKind: 'html-canonical', documentHash: canonical.documentHash, records, stableText: '',
    noteEvidencePolicyId: policy.id, captionCoverage: { complete: true, allParagraphIds: captions.map(c => c.paragraphId), completeParagraphIds: completeIds, missingParagraphIds: [] } };
  const expected = JSON.parse(api.compileLiteratureNoteAutofillPrompt(template, document, { outputLanguage: 'zh-CN', noteEvidencePolicy: policy }).userPrompt.split(delimiter)[1]);
  if (JSON.stringify(payload) !== JSON.stringify(expected)) fail('NOTE016_GUIDANCE_MISMATCH');
  return { template, noteEvidencePolicy: policy, document, fieldIds: requested, paragraphIds: [...ids],
    completeResultIds: completeResults, completeCaptionIds: completeIds, evidenceCharacters: rows.map(r => JSON.stringify(r)).join('\n').length };
}

export async function loadCredential(args, deps = {}) {
  if (!args.executeLive) fail('NOTE016_LIVE_AUTHORIZATION_REQUIRED');
  const profile = await (deps.loadProfile || loadLivePortableProfile)(args.portableConfig, args.profile, { expectedModel: MODEL });
  if (profile.name !== 'DS' || profile.providerId !== 'deepseek' || profile.model !== MODEL || profile.baseUrl !== '' ||
    profile.sourceSha256 !== args.configSha256 || profile.revision !== Number(args.configRevision)) fail('NOTE016_PROFILE_MISMATCH');
  if (!profile.apiKey || /[\r\n]/u.test(profile.apiKey)) fail('NOTE016_CREDENTIAL_INVALID');
  const result = { metadata: { name: profile.name, providerId: profile.providerId, model: profile.model,
    baseUrl: profile.baseUrl, revision: profile.revision, sourceSha256: profile.sourceSha256, mode: 'hidden TTY password; memory-only API key' } };
  Object.defineProperty(result, 'secret', { value: profile.apiKey, enumerable: false }); return result;
}

export function createForwarder({ canonical, api, secret, callCap = 4, timeoutMs = 180000, signal,
  fetchImpl = createCurlFetch({ timeoutMs }), record = () => {} }) {
  if (!Number.isSafeInteger(callCap) || callCap < 1 || callCap > 5) fail('NOTE016_CALL_CAP_INVALID');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) fail('NOTE016_TIMEOUT_INVALID');
  let calls = 0, enabled = true;
  return { get calls() { return calls; }, disable() { enabled = false; }, async forward(text) {
    if (!enabled || signal?.aborted) fail('NOTE016_PROVIDER_DISABLED');
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) fail('NOTE016_REQUEST_TOO_LARGE');
    let body; try { body = JSON.parse(text); } catch { fail('NOTE016_REQUEST_INVALID'); }
    const inspected = inspectRequest(body, canonical, api);
    if (calls >= callCap) fail('NOTE016_CALL_CAP');
    const entry = { sequence: ++calls, fieldIds: inspected.fieldIds, paragraphIds: inspected.paragraphIds,
      documentHash: canonical.documentHash, completeResultIds: inspected.completeResultIds, completeCaptionIds: inspected.completeCaptionIds,
      evidenceCharacters: inspected.evidenceCharacters, requestedOutputCap: body.max_tokens, status: null };
    record(entry, { request: text });
    try {
      const response = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: text, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
      const chunks = []; let size = 0;
      for await (const part of response.body) { size += part.length; if (size > 16 * 1024 * 1024) fail('NOTE016_RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(part)); }
      const bytes = Buffer.concat(chunks);
      if (secret && bytes.includes(Buffer.from(secret))) fail('NOTE016_RESPONSE_SECRET');
      Object.assign(entry, { status: response.status, responseBytes: size, responseSha256: sha(bytes) });
      try {
        const envelope = JSON.parse(bytes.toString('utf8')); entry.finishReason = envelope.choices?.[0]?.finish_reason;
        if (entry.finishReason !== 'stop' || response.status !== 200) fail('NOTE016_RESPONSE_NOT_COMPLETE');
        const raw = api.parseJsonText(envelope.choices[0].message.content);
        entry.schemaEvidence = Object.fromEntries(inspected.fieldIds.map(id => [id, {
          status: raw?.statuses?.[id], valueCharacters: typeof raw?.values?.[id] === 'string' ? raw.values[id].length : null,
          sourceCount: Array.isArray(raw?.sources?.[id]) ? raw.sources[id].length : null, sourceLimit: id === 'main_findings' ? 32 : 12
        }]));
        const result = api.validateLiteratureNoteAutofillResponse(raw, inspected.template, inspected.document, { noteEvidencePolicy: inspected.noteEvidencePolicy });
        entry.validated = result; entry.htmlSources = {};
        for (const field of inspected.template.fields) if (result.statuses[field.id] === 'supported') {
          entry.htmlSources[field.id] = api.prepareLiteratureNoteHtmlSources({ value: result.values[field.id], sourceIds: result.sources[field.id],
            documentHash: canonical.documentHash, template: { ...inspected.template, fields: [field] }, noteEvidencePolicy: inspected.noteEvidencePolicy,
            receipt: { documentHash: canonical.documentHash, noteEvidencePolicyId: inspected.noteEvidencePolicy.id, records: inspected.document.records } });
        }
      } catch (error) { entry.validation = 'not-valid-as-received; unmodified bytes returned to production'; entry.validationErrorCode = safeCode(error); }
      record(entry, { response: bytes.toString('utf8') });
      return { status: response.status, contentType: response.headers.get('content-type') || 'application/json', bytes };
    } catch (error) { entry.errorCode = safeCode(error); record(entry, {}); throw error; }
  } };
}

export function inspectFindings(value, canonical) {
  const expected = inspectCanonical(canonical).captions.map(c => c.label?.id).filter(Boolean), groups = [], issues = [];
  const lines = String(value || '').split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    if (!/^[-*+]\s+\S/u.test(lines[i])) continue;
    const heading = lines[i].replace(/^[-*+]\s+/u, '').replace(/\*\*/gu, '').trim();
    const label = heading.match(/^(?:(Extended Data|扩展数据)\s*)?(?:Fig\.?|Figure|图)\s*(\d+)\s*$/iu);
    if (!label) { issues.push('FIGURE_TOP_LEVEL_STRUCTURE'); continue; }
    groups.push((label[1] ? 'ED' : '') + label[2]);
    const next = lines.slice(i + 1).find(line => line.trim());
    if (!next || !/^\s+[-*+]\s+\S/u.test(next)) issues.push('FIGURE_CONCLUSION_MISSING');
  }
  if (JSON.stringify(groups) !== JSON.stringify(expected)) issues.push('FIGURE_GROUP_COVERAGE_OR_ORDER');
  return { groups, expected, issues: [...new Set(issues)], scientificReview: 'Manual source review required for all conclusions, Panels, quantities and inference boundaries.' };
}

export function inspectInitialPopup(popup) {
  if (popup.fields?.length !== 9 || popup.fields.some(f => !f.empty || f.visible) ||
    popup.captionSourceCount !== 13 || popup.globalToggleCount !== 1 || popup.globalTogglePressed !== 'true' || popup.perFieldToggleCount !== 0) fail('NOTE016_INITIAL_UI_INVALID');
  return { blankDefaultFields: 9, captionSources: 13, defaultRenderedMode: true, oneGlobalToggle: true };
}

export function classifyRun(calls, fields) {
  if (!calls.length || calls.some(c => c.validation || c.errorCode || c.status !== 200)) return 'FAIL_RESPONSE';
  if (fields.some(f => f.structure?.issues?.length)) return 'FAIL_STRUCTURE';
  return 'PASS_FUNCTIONAL_REVIEW_REQUIRED';
}

export function inspectPreservedFields(before, after, fieldIds) {
  const preserved = fieldIds.filter(id => before.valuesByTemplate?.basic_research?.[id]);
  for (const id of preserved) for (const key of ['valuesByTemplate', 'fieldStatusByTemplate', 'fieldEvidenceByTemplate', 'fieldUpdatedAtByTemplate']) {
    assert.deepEqual(after[key]?.basic_research?.[id], before[key]?.basic_research?.[id], `NOTE016_EXISTING_FIELD_CHANGED:${key}:${id}`);
  }
  return preserved;
}

export function inspectSavedFields(before, after, calls, api, canonical, fieldIds) {
  const results = [];
  for (const id of fieldIds) {
    const value = after.valuesByTemplate?.basic_research?.[id], prior = before.valuesByTemplate?.basic_research?.[id];
    const candidates = calls.filter(c => c.fieldIds.includes(id));
    const call = candidates.findLast(c => c.validated?.statuses?.[id] === 'supported' && c.htmlSources?.[id]?.sourcesSaved && c.htmlSources[id].value === value);
    if (!call) {
      if (candidates.some(c => c.validated?.statuses?.[id] === 'missing') && !value) { results.push({ fieldId: id, status: 'missing' }); continue; }
      const error = Object.assign(new Error('NOTE016_GENERATION_FAILED'), { code: 'NOTE016_GENERATION_FAILED', details: { fieldId: id,
        previousValueUnchanged: value === prior, attempts: candidates.map(c => ({ sequence: c.sequence, validation: c.validation, validationErrorCode: c.validationErrorCode, finishReason: c.finishReason })) } });
      throw error;
    }
    const projection = api.projectLiteratureNoteSources(value), savedIds = projection.references?.flatMap(r => r.sourceIds) || [];
    if (!projection.ok || call.documentHash !== canonical.documentHash ||
      JSON.stringify([...new Set(savedIds)].sort()) !== JSON.stringify([...new Set(call.validated.sources[id])].sort())) fail('NOTE016_SAVED_SOURCE_BINDING');
    results.push({ fieldId: id, status: 'supported', sequence: call.sequence, valueSha256: sha(value), sourceIds: savedIds,
      ...(id === 'main_findings' ? { structure: inspectFindings(call.validated.values[id], canonical) } : {}),
      ...(id === 'research_background' ? { structure: inspectLegacyStructure(id, call.validated.values[id], {}, {}) } : {}) });
  }
  return results;
}

function copyExtension(source, target) {
  fs.mkdirSync(target); const hashes = {};
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(source, dir), path.join(target, dir), { recursive: true });
  for (const file of fs.readdirSync(source)) if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(source, file), path.join(target, file));
  const collect = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name); if (e.isDirectory()) collect(f);
    else hashes[path.relative(target, f).replaceAll('\\', '/')] = sha(fs.readFileSync(f));
  } }; collect(target); return hashes;
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArguments(argv), extensionRoot = path.resolve(args.extensionRoot), sourceBytes = fs.readFileSync(args.html);
  if (sourceBytes.length > 8 * 1024 * 1024 || !sourceBytes.includes(Buffer.from('s41586-025-09984-y'))) fail('NOTE016_HTML_INVALID');
  const outputBase = path.resolve(args.outputDir || path.join(root, 'output/playwright/note016-live-nature'));
  fs.mkdirSync(outputBase, { recursive: true }); const output = fs.mkdtempSync(path.join(outputBase, args.executeLive ? 'run-' : 'preflight-'));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-note016-')), extension = path.join(temporary, 'extension');
  const report = { taskId: 'NOTE016', output, status: 'RUNNING', phase: 'canonical-extraction', realApiCalls: 0, credentialRead: false,
    entrySha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
    source: { html: path.resolve(args.html), bytes: sourceBytes.length, sha256: sha(sourceBytes), canonicalUrl: ARTICLE_URL },
    sourceHashes: copyExtension(extensionRoot, extension), errors: [], checks: [], blockedRequests: 0,
    boundary: 'Original downloaded Nature HTML routed at its exact canonical URL; production extraction in a fresh isolated extension/profile. No inventory reconstruction or user archive access.' };
  let secret = '';
  const write = (name, data) => { const raw = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(path.join(output, name), sanitizedReplay(secret ? raw.split(secret).join('[REDACTED_SECRET]') : raw)); };
  const persist = () => write('report.json', report);
  let context, panel, worker, paper, server, forwarder, proxy = '', timer;
  const controller = new AbortController(), dummy = 'note016-local-' + crypto.randomBytes(20).toString('hex');
  report.providerCalls = []; report.fields = [];
  controller.signal.addEventListener('abort', () => { context?.close().catch(() => {}); server?.closeAllConnections(); }, { once: true });
  const armDeadline = milliseconds => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), milliseconds); };
  if (args.executeLive) {
    server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      try {
        if (!forwarder || req.method !== 'POST' || req.url !== '/chat/completions' || req.headers.authorization !== `Bearer ${dummy}`) fail('NOTE016_PROXY_REJECTED');
        const parts = []; let size = 0;
        for await (const part of req) { size += part.length; if (size > 8 * 1024 * 1024) fail('NOTE016_REQUEST_TOO_LARGE'); parts.push(part); }
        const response = await forwarder.forward(Buffer.concat(parts).toString('utf8'));
        res.writeHead(response.status, { 'Content-Type': response.contentType }); res.end(response.bytes);
      } catch (error) { report.boundaryErrorCode = safeCode(error); persist(); res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: safeCode(error) } })); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); proxy = `http://127.0.0.1:${server.address().port}`;
  }
  const network = path.join(extension, 'offscreen-network-worker.js');
  const wrapper = args.executeLive
    ? `const note016Fetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(url,options)=>{if(String(url)!==${JSON.stringify(ENDPOINT)})throw Error('NOTE016_REMOTE_BLOCKED');return note016Fetch(${JSON.stringify(proxy + '/chat/completions')},options);};\n`
    : "globalThis.fetch=()=>{throw Error('NOTE016_PREFLIGHT_NETWORK_BLOCKED');};\n";
  fs.writeFileSync(network, wrapper + fs.readFileSync(network, 'utf8'));
  const transportHash = sha(fs.readFileSync(network)); armDeadline(Math.min(args.deadlineMs, 180000));
  persist();
  try {
    const { chromium } = await import('playwright');
    context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: !args.headed,
      reducedMotion: 'reduce', viewport: { width: 1280, height: 1000 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking'] });
    if (controller.signal.aborted) fail('NOTE016_DEADLINE');
    context.setDefaultTimeout(30000); context.setDefaultNavigationTimeout(30000);
    await context.route(/^https?:\/\//u, route => {
      if (route.request().url() === ARTICLE_URL) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: sourceBytes });
      if (proxy && route.request().url().startsWith(proxy + '/')) return route.continue();
      report.blockedRequests++; return route.abort('blockedbyclient');
    });
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    report.phase = 'article-navigation'; persist();
    paper = context.pages()[0] || await context.newPage(); await paper.goto(ARTICLE_URL, { waitUntil: 'domcontentloaded' });
    const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url), ARTICLE_URL);
    if (!tab?.id) fail('NOTE016_TAB_MISSING');
    report.phase = 'content-activation'; persist();
    await worker.evaluate(async t => {
      const activation = await SciLLM.markTabActivated(chrome.storage.session, t);
      await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
      await SciLLM.ensureContentScriptForActivation(chrome, t.id);
    }, tab);
    panel = await context.newPage(); await panel.setViewportSize({ width: 620, height: 960 });
    report.phase = 'popup-binding'; persist();
    panel.on('pageerror', error => report.errors.push(String(error.message).slice(0, 400)));
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), tab.id); await paper.bringToFront();
    await panel.waitForFunction(() => typeof panelUiReady !== 'undefined' && panelUiReady);
    await panel.evaluate(async () => {
      await synchronizeActiveTabContext({ force: true });
      if (!activePanelTabContext.activated) { await activateCurrentTabFromSidePanel(); await synchronizeActiveTabContext({ force: true }); }
      await refreshArticleWorkspace({ announce: false, throwOnError: true });
    });
    await panel.locator('#openLiteratureNote').click();
    await panel.waitForFunction(() => literatureNoteDocumentState?.valuesByTemplate && document.getElementById('literatureNoteTemplateSelect')?.value === literatureNoteDocumentState.templateId);
    report.phase = 'canonical-extraction'; persist();
    const canonical = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const snapshot = getCanonicalArticleSnapshot({ forceRefresh: true });
      const direct = SciLLM.extractArticle(document, { includeTyped: true });
      return { title: document.title, url: snapshot.url, documentHash: snapshot.documentHash,
        paragraphs: snapshot.paragraphs, typedRecords: snapshot.typedRecords,
        diagnostics: { adapterId: SciLLM.selectPublisherAdapter(location, document).id,
          directTypedCaptionCount: direct.filter(r => r.recordType === 'figure-caption').length,
          domFigureCaptions: document.querySelectorAll('figure figcaption').length,
          figureDom: [...document.querySelectorAll('figure')].map(f => ({ id: f.id,
            caption: f.querySelector('figcaption')?.textContent,
            description: [...f.querySelectorAll('.c-article-section__figure-description > p')]
              .filter(p => !/^(?:Source data|Full size image)$/i.test(p.textContent.trim())).map(p => p.textContent).join(' '),
            children: [...f.children].map(e => ({ tag: e.tagName, className: e.className })) })),
          extendedDom: [...document.querySelectorAll('.c-article-supplementary__item')].filter(e => /^Extended Data Fig/i.test(e.querySelector('h3')?.textContent?.trim() || ''))
            .map(e => ({ id: e.id, tag: e.tagName, className: e.className,
              caption: e.querySelector('h3')?.textContent,
              description: [...e.querySelectorAll('.c-article-supplementary__description > p')].filter(p => !/^(?:Source data|Full size image)$/i.test(p.textContent.trim())).map(p => p.textContent).join(' '),
              children: [...e.children].map(c => ({ tag: c.tagName, className: c.className, text: c.textContent.slice(0, 200) })) })) } };
    } }))[0].result, tab.id);
    canonical.diagnostics.sourceCaptionDom = [...canonical.diagnostics.figureDom, ...canonical.diagnostics.extendedDom]
      .map(f => ({ domId: f.id, label: figureLabelAtStart(f.caption), caption: norm(f.caption), description: norm(f.description) }));
    write('canonical-article-snapshot.json', canonical);
    report.canonical = inspectCanonical(canonical); report.extractionDiagnostics = canonical.diagnostics;
    report.popup = await panel.evaluate(() => ({ documentHash: currentWorkspaceSnapshot?.documentHash,
      captionSourceCount: currentWorkspaceSnapshot?.literatureNoteCaptionSources?.length,
      templateId: literatureNoteDocumentState?.templateId,
      fields: [...document.querySelectorAll('[data-literature-note-field]')].map(e => ({ id: e.dataset.literatureNoteField, visible: e.checkVisibility(), empty: !e.value })),
      globalToggleCount: document.querySelectorAll('#toggleLiteratureNoteMarkdown').length,
      globalTogglePressed: document.getElementById('toggleLiteratureNoteMarkdown')?.getAttribute('aria-pressed'),
      perFieldToggleCount: document.querySelectorAll('.literature-note-editor-toggle').length }));
    await panel.screenshot({ path: path.join(output, 'initial-popup.png') });
    if (report.popup.documentHash !== canonical.documentHash) fail('NOTE016_POPUP_DOCUMENT_MISMATCH');
    const api = loadProduction(extension), template = api.normalizeLiteratureNoteTemplates()[0];
    const policy = api.resolveLiteratureNoteEvidencePolicy(template, { sourceKind: 'html-canonical' });
    const doc = api.buildResearchEvidenceDocument({ ...canonical, sourceKind: 'html-canonical', paragraphs: [
      ...canonical.paragraphs, ...canonical.typedRecords.filter(r => r.recordType === 'figure-caption')
    ] }, { evidencePurpose: 'literature-note', maxCharacters: 128000, noteEvidencePolicy: policy });
    const prompt = api.compileLiteratureNoteAutofillPrompt(template, doc, { outputLanguage: 'zh-CN', noteEvidencePolicy: policy });
    fs.writeFileSync(path.join(output, 'preflight-production-prompt.json'), JSON.stringify(prompt, null, 2) + '\n');
    report.preflight = { characterCount: doc.characterCount, recordCount: doc.records.length, captionCoverage: doc.captionCoverage,
      includedMainResults: report.canonical.resultParagraphIds.filter(id => doc.records.some(r => r.paragraphId === id)),
      deterministicOutline: prompt.userPrompt.includes('Verified complete-caption Figure order:') };
    if (report.canonical.ready) {
      report.preflight.initialUi = inspectInitialPopup(report.popup);
      const inspected = inspectRequest({ model: MODEL, stream: false, max_tokens: 12288,
        messages: [{ role: 'system', content: prompt.systemPrompt }, { role: 'user', content: prompt.userPrompt }] }, canonical, api);
      report.preflight.completeCaptionIds = inspected.completeCaptionIds;
      report.preflight.completeResultIds = inspected.completeResultIds;
    }
    report.status = report.canonical.ready ? 'PREFLIGHT_READY' : 'SOURCE_BLOCKED';
    report.phase = 'preflight-completed';
    if (args.executeLive && report.canonical.ready) {
      clearTimeout(timer); report.phase = 'credential'; persist();
      const credential = await loadCredential(args); secret = credential.secret; report.credentialRead = true; report.credential = credential.metadata;
      armDeadline(args.deadlineMs);
      report.limits = { callCap: args.callCap, providerTimeoutMs: args.providerTimeoutMs, deadlineMs: args.deadlineMs, deadlineStarts: 'after hidden TTY input' };
      report.isolatedProfile = { providerId: 'deepseek', model: MODEL, baseUrl: '', reasoningEnabled: false,
        scope: 'Uses the verified saved DS credential and identity; NOTE011 isolated non-thinking setup, not import of all personal profile settings.' };
      forwarder = createForwarder({ canonical, api, secret, callCap: args.callCap, timeoutMs: args.providerTimeoutMs, signal: controller.signal,
        record(entry, artifacts) { report.realApiCalls = forwarder.calls; report.providerCalls[entry.sequence - 1] = entry;
          for (const [kind, data] of Object.entries(artifacts)) write(`provider-${entry.sequence}-${kind}-redacted.json`, data); persist(); } });
      const snapshot = () => panel.evaluate(() => ({ state: structuredClone(literatureNoteDocumentState),
        templates: structuredClone(literatureNoteTemplates()), documentHash: currentWorkspaceSnapshot.documentHash }));
      const saved = () => panel.waitForFunction(() => !literatureNoteAutofillPromise && !literatureNoteSaveTimer && literatureNoteDirtyRevisions.size === 0,
        null, { timeout: Math.min(args.deadlineMs, args.providerTimeoutMs * args.callCap + 30000) });
      await panel.evaluate(async ({ dummy, model }) => {
        for (const message of [
          { type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_note016_live', name: 'NOTE016 isolated DS', providerId: 'deepseek', config: { apiKey: dummy, model, reasoningEnabled: false } } },
          { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_note016_live', taskRoutes: {} },
          { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
        ]) if (!(await chrome.runtime.sendMessage(message))?.success) throw Error('NOTE016_PROFILE_SETUP');
        await loadLlmSettings();
      }, { dummy, model: MODEL });
      const before = await snapshot(); write('before-note-state.json', before);
      report.phase = 'batch-nine-fields'; persist();
      await panel.locator('#autofillLiteratureNote').click(); await saved();
      const generated = await snapshot(); write('generated-note-state.json', generated);
      if (!forwarder.calls) fail('NOTE016_NO_REAL_REQUEST');
      report.fields = inspectSavedFields(before.state, generated.state, report.providerCalls, api, canonical, template.fields.map(f => f.id));
      if (!report.fields.some(f => f.fieldId === 'main_findings' && f.status === 'supported')) fail('NOTE016_MAIN_FINDINGS_MISSING');
      assert.deepEqual(generated.templates, before.templates);
      report.rendered = await panel.locator('.literature-note-editor-preview').evaluateAll(nodes => nodes.map(n => ({ visible: n.checkVisibility(), characters: n.textContent.length, listItems: n.querySelectorAll('li').length })));
      if (report.rendered.length !== 9 || report.rendered.some(r => !r.visible)) fail('NOTE016_DEFAULT_RENDERING_FAILED');
      await panel.screenshot({ path: path.join(output, 'batch-rendered.png') });
      await panel.locator('.literature-note-field').filter({ has: panel.locator('[data-literature-note-field="main_findings"]') })
        .screenshot({ path: path.join(output, 'main-findings-rendered.png') });
      report.phase = 'protect-manual-and-filled-fields'; persist();
      await panel.locator('#toggleLiteratureNoteMarkdown').click();
      const manual = 'NOTE016 isolated manual sibling: preserve this exact value.';
      await panel.locator('[data-literature-note-field="innovations"]').fill(manual); await saved();
      await panel.locator('#toggleLiteratureNoteMarkdown').click();
      const protectedBefore = await snapshot(), callsBeforeProtected = forwarder.calls;
      write('before-protected-batch-note-state.json', protectedBefore);
      await panel.locator('#autofillLiteratureNote').click(); await saved();
      const protectedAfter = await snapshot(); write('after-protected-batch-note-state.json', protectedAfter);
      const preservedFields = inspectPreservedFields(protectedBefore.state, protectedAfter.state, template.fields.map(f => f.id));
      assert.equal(protectedAfter.state.valuesByTemplate.basic_research.innovations, manual);
      assert.deepEqual(protectedAfter.templates, protectedBefore.templates);
      report.protectedBatch = { additionalCalls: forwarder.calls - callsBeforeProtected, preservedManual: true,
        preexistingFilledFields: preservedFields };
      if (args.singleFollowup) {
        report.phase = 'single-main-followup'; persist(); const priorCalls = forwarder.calls, prior = await snapshot();
        await panel.locator('[data-generate-literature-note-field="main_findings"]').click(); await saved();
        const current = await snapshot(); write('single-main-note-state.json', current);
        report.singleFollowup = inspectSavedFields(prior.state, current.state, report.providerCalls.slice(priorCalls), api, canonical, ['main_findings']);
        inspectPreservedFields(prior.state, current.state, template.fields.map(f => f.id).filter(id => id !== 'main_findings'));
      }
      const completed = await snapshot(); write('completed-note-state.json', completed);
      report.phase = 'reopen-popup'; persist(); const callsBeforeReopen = forwarder.calls; forwarder.disable();
      const popupUrl = panel.url(); await panel.close(); panel = await context.newPage(); await panel.setViewportSize({ width: 620, height: 960 });
      await panel.goto(popupUrl); await worker.evaluate(id => chrome.tabs.update(id, { active: true }), tab.id); await paper.bringToFront();
      await panel.waitForFunction(() => typeof panelUiReady !== 'undefined' && panelUiReady);
      await panel.evaluate(async () => { await synchronizeActiveTabContext({ force: true }); await refreshArticleWorkspace({ announce: false, throwOnError: true }); });
      await panel.locator('#openLiteratureNote').click();
      await panel.waitForFunction(expected => JSON.stringify(literatureNoteDocumentState?.valuesByTemplate) === expected, JSON.stringify(completed.state.valuesByTemplate));
      const reopened = await snapshot(); write('reopened-note-state.json', reopened);
      const comparison = inspectReopenedNoteState(completed.state, reopened.state, api); write('reopened-state-comparison.json', comparison);
      assertReopenedNoteState(comparison); assert.equal(reopened.documentHash, canonical.documentHash); assert.deepEqual(reopened.templates, before.templates);
      assert.equal(forwarder.calls, callsBeforeReopen); report.reopened = true; report.reopenMode = 'new popup; same isolated Edge process';
      await panel.screenshot({ path: path.join(output, 'reopened.png') });
      const issues = [...report.fields, ...(report.singleFollowup || [])].flatMap(f => f.structure?.issues || []);
      report.status = classifyRun(report.providerCalls, [...report.fields, ...(report.singleFollowup || [])]); report.structureIssues = issues;
      report.scientificReview = 'No automatic scientific PASS; manually review actual claims against the unchanged source and captured request.';
      report.phase = 'completed';
    }
  } catch (error) {
    report.status = 'FAIL'; report.errorCode = safeCode(error); report.errorMessage = String(error.message).slice(0, 300);
    if (error.details) report.generationFailure = error.details;
    if (panel && !panel.isClosed()) {
      const observed = await panel.evaluate(() => typeof literatureNoteDocumentState === 'undefined' ? null : structuredClone(literatureNoteDocumentState)).catch(() => null);
      write('failure-observed-note-state.json', observed);
    }
    if (panel && !panel.isClosed()) await panel.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {});
  } finally {
    clearTimeout(timer); controller.abort(); await context?.close(); report.browserClosed = true;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    report.workingTreeChanges = Object.entries(report.sourceHashes).filter(([file, digest]) => sha(fs.readFileSync(path.join(extensionRoot, file))) !== digest).map(([file]) => file);
    report.sourceFilesUnchanged = report.workingTreeChanges.length === 0;
    report.isolatedSnapshotUnchanged = Object.entries(report.sourceHashes).every(([file, digest]) =>
      sha(fs.readFileSync(path.join(extension, file))) === (file === 'offscreen-network-worker.js' ? transportHash : digest));
    report.htmlFileUnchanged = sha(fs.readFileSync(args.html)) === report.source.sha256;
    if (!report.isolatedSnapshotUnchanged || !report.htmlFileUnchanged) { report.status = 'FAIL'; report.errorCode = 'NOTE016_SOURCE_CHANGED'; }
    persist(); secret = '';
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run().then(report => {
  process.stdout.write(JSON.stringify({ status: report.status, output: report.output, canonical: report.canonical, errorCode: report.errorCode }) + '\n');
  if (!['PREFLIGHT_READY', 'PASS_FUNCTIONAL_REVIEW_REQUIRED'].includes(report.status)) process.exitCode = 1;
}).catch(error => { process.stderr.write(safeCode(error) + '\n'); process.exitCode = 1; });
