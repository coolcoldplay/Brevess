// NOTE-011 acceptance only. Real UI + transparent provider boundary; never fabricates responses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadMechanismArticle } from './lib/mechanism-acceptance-input.mjs';
import { createCurlFetch } from './lib/live-curl-fetch.mjs';
import { loadLivePortableProfile } from './lib/live-portable-profile.mjs';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';
import { sanitizedReplay } from './verify-live-web-chat-extension.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL = 'deepseek-flash';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const FIELDS = ['research_background', 'main_findings'];
const TITLE = 'Stress-induced sympathetic hyperactivation drives hair follicle necrosis to trigger autoimmunity';
const URL = 'https://www.cell.com/cell/fulltext/S0092-8674(25)01247-4';
const PURE_FILES = ['providers/provider-utils.js', 'core/research-evidence.js', 'core/reading-tools.js', 'core/literature-note-sources.js', 'core/literature-note-source-storage.js'];
const MAX_BYTES = 8 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const norm = value => String(value || '').normalize('NFKC').replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim();
const safeCode = error => /^[A-Z][A-Z0-9_]{2,80}$/u.test(error?.code || '') ? error.code : 'NOTE011_ACCEPTANCE_FAILED';
const html = value => String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function parseArguments(argv) {
  const args = { model: MODEL, transport: 'curl', callCap: 8, providerTimeoutMs: 180000, deadlineMs: 1200000, live: false };
  const values = new Set(['article', 'source-manifest', 'extension-root', 'output-dir', 'portable-config', 'profile', 'profile-model-override', 'model', 'transport', 'call-cap', 'provider-timeout-ms', 'deadline-ms']);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--live') { args.live = true; continue; }
    if (argv[i] === '--preflight-only') { args.preflightOnly = true; continue; }
    if (argv[i] === '--headed') { args.headed = true; continue; }
    if (!argv[i].startsWith('--')) fail('NOTE011_ARGUMENT_INVALID');
    const name = argv[i].slice(2), value = argv[++i];
    if (!values.has(name) || !value || value.startsWith('--')) fail('NOTE011_ARGUMENT_INVALID');
    args[name.replace(/-([a-z])/gu, (_, c) => c.toUpperCase())] = value;
  }
  if (!args.article || !args.sourceManifest || args.model !== MODEL || args.transport !== 'curl' || (args.live && args.preflightOnly)) fail('NOTE011_ARGUMENT_INVALID');
  for (const [key, min, max] of [['callCap', 2, 8], ['providerTimeoutMs', 1000, 180000], ['deadlineMs', 10000, 1800000]]) {
    args[key] = Number(args[key]);
    if (!Number.isSafeInteger(args[key]) || args[key] < min || args[key] > max) fail('NOTE011_ARGUMENT_INVALID');
  }
  if (Boolean(args.portableConfig) !== Boolean(args.profile)) fail('NOTE011_PROFILE_REQUIRED');
  if (args.profileModelOverride && (!args.portableConfig || args.profileModelOverride !== MODEL)) fail('NOTE011_MODEL_OVERRIDE_INVALID');
  return args;
}

export function loadProduction(sourceRoot = root) {
  const sandbox = vm.createContext({ module: { exports: {} } });
  for (const file of PURE_FILES) {
    vm.runInContext(fs.readFileSync(path.join(sourceRoot, file), 'utf8'), sandbox, { filename: file });
  }
  // Public inputs are JSON payloads. Recreate them in the module's realm so its
  // strict plain-object guards behave exactly as in the extension, unchanged.
  const intoRealm = vm.runInContext('value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))', sandbox);
  const outOfRealm = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  return Object.fromEntries(Object.entries(sandbox.SciLLM).map(([name, value]) => [name,
    typeof value === 'function' ? (...args) => outOfRealm(value(...args.map(intoRealm))) : outOfRealm(value)]));
}

export function loadSource(articleFile, manifestFile) {
  const article = loadMechanismArticle(articleFile, manifestFile);
  if (article.title !== TITLE || article.url !== URL || article.paragraphs.length !== 94 || article.figures.length !== 14) fail('NOTE011_SOURCE_IDENTITY');
  return { ...article, sourceSha256: hash(fs.readFileSync(articleFile)), manifestSha256: hash(fs.readFileSync(manifestFile)) };
}

export function figureIds(text) {
  const found = new Set();
  for (const m of norm(text).matchAll(/(?:\b(?:figures?|figs?)\.?\s*|(?:补充|补)?图\s*)(S?\d+[A-Z]?(?:\s*(?:,|、|和|and|to|[-–—])\s*S?\d+[A-Z]?)*)(?!\d)/giu)) {
    const tokens = [...m[1].matchAll(/S?\d+/giu)];
    for (let i = 0; i < tokens.length; i++) {
      const id = tokens[i][0].toUpperCase(); found.add(id);
      const previous = tokens[i - 1];
      if (previous && /^\s*(?:to|[-–—])\s*$/iu.test(m[1].slice(previous.index + previous[0].length, tokens[i].index)) &&
          previous[0].toUpperCase().startsWith('S') === id.startsWith('S')) {
        const from = Number(previous[0].replace(/S/iu, '')), to = Number(id.replace('S', ''));
        for (let n = from + 1; n < Math.min(to, from + 1000); n++) found.add((id.startsWith('S') ? 'S' : '') + n);
      }
    }
  }
  return [...found];
}

export function coverage(records, article) {
  const sent = records.map(r => norm(r.text));
  const fullCaptions = [], partialCaptions = [], mentionedFigures = [];
  for (const f of article.figures) {
    const id = f.label.replace(/^Figure\s+/u, ''), caption = norm(f.caption);
    if (sent.some(t => t.includes(caption))) fullCaptions.push(id);
    else if (sent.some(t => t.includes(caption.slice(0, 100)))) partialCaptions.push(id);
    if (sent.some(t => figureIds(t).includes(id))) mentionedFigures.push(id);
  }
  const all = article.figures.map(f => f.label.replace(/^Figure\s+/u, ''));
  return { recordCount: records.length, textCharacters: records.reduce((n, r) => n + r.text.length, 0), fullCaptions, partialCaptions, mentionedFigures,
    missingFullCaptions: all.filter(id => !fullCaptions.includes(id)), fullFigureCaptionCoverage: fullCaptions.length === all.length,
    caveat: 'A Figure mention does not prove a supported finding; complete captions still require scientific interpretation review.' };
}

export function inspectRequest(body, article, api) {
  if (body?.model !== MODEL || body.stream === true || !Array.isArray(body.messages)) fail('NOTE011_REQUEST_INVALID');
  const text = body.messages.filter(m => m.role === 'user' && typeof m.content === 'string').map(m => m.content).join('\n');
  const delimiter = '\nLITERATURE_NOTE_REQUEST:\n', split = text.lastIndexOf(delimiter);
  if (split < 0) fail('NOTE011_REQUEST_INVALID');
  let payload;
  try { payload = JSON.parse(text.slice(split + delimiter.length)); } catch { fail('NOTE011_REQUEST_INVALID'); }
  const lines = text.slice(0, split).split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const records = lines.filter(v => v.paragraphId), title = lines.find(v => v.documentTitle)?.documentTitle;
  const field = payload.template?.fields?.[0];
  if (norm(title) !== norm(article.title) || payload.task !== 'fill_literature_note' || payload.template?.id !== 'basic_research' ||
      payload.template.fields.length !== 1 || !FIELDS.includes(field?.id) || !records.length) fail('NOTE011_REQUEST_IDENTITY');
  const template = api.normalizeLiteratureNoteTemplates().find(t => t.id === 'basic_research');
  template.fields = template.fields.filter(f => f.id === field.id);
  const noteEvidencePolicy = api.resolveLiteratureNoteEvidencePolicy(template, { sourceKind: 'html-canonical' });
  const corpus = [...article.paragraphs.map(p => p.text), ...article.figures.flatMap(f => [f.caption, `${f.label}. ${f.title} ${f.caption}`])].map(norm);
  const typedCaptions = (article.runtimeTypedRecords || []).filter(r => r.recordType === 'figure-caption');
  // Offline preflight uses its explicit caption projection. Live requests must
  // use captured runtime typed records, never this fallback.
  const captionBasis = article.runtimeParagraphs ? typedCaptions : article.figures.map(f => ({
    paragraphId: f.sourceId, text: `${f.label}. ${f.title} ${f.caption}`
  }));
  const runtimeRecords = article.runtimeParagraphs && [...article.runtimeParagraphs,
    ...(noteEvidencePolicy.captionFirst ? typedCaptions : [])];
  const ids = new Set();
  for (const r of records) {
    if (ids.has(r.paragraphId) || !r.documentHash || !r.sourceKey || !r.textHash || !norm(r.text) ||
        !corpus.some(t => t.includes(norm(r.text))) || (article.runtimeDocumentHash && r.documentHash !== article.runtimeDocumentHash)) fail('NOTE011_SOURCE_BINDING');
    ids.add(r.paragraphId);
    if (runtimeRecords) {
      const matches = runtimeRecords.filter(p => p.paragraphId === r.paragraphId && p.sourceKey === r.sourceKey &&
        String(p.sourceIdentity || '') === String(r.sourceIdentity || '') &&
        p.textHash === r.textHash && norm(p.text).startsWith(norm(r.text)));
      if (matches.length !== 1) fail('NOTE011_SOURCE_BINDING');
    }
  }
  if (new Set(records.map(r => r.documentHash)).size !== 1) fail('NOTE011_SOURCE_BINDING');
  const completeCaptionIds = captionBasis.filter(p => records.some(r => r.paragraphId === p.paragraphId && norm(r.text) === norm(p.text))).map(p => p.paragraphId);
  const captionCoverage = noteEvidencePolicy.captionFirst ? {
    complete: captionBasis.length > 0 && completeCaptionIds.length === captionBasis.length,
    allParagraphIds: captionBasis.map(p => p.paragraphId), completeParagraphIds: completeCaptionIds,
    missingParagraphIds: captionBasis.filter(p => !completeCaptionIds.includes(p.paragraphId)).map(p => p.paragraphId)
  } : null;
  // Rebuild dynamic guidance only after verifying the actual sent source records.
  const expected = JSON.parse(api.compileLiteratureNoteAutofillPrompt(template, { stableText: '', records,
    sourceKind: 'html-canonical', documentHash: records[0].documentHash,
    ...(captionCoverage ? { noteEvidencePolicyId: noteEvidencePolicy.id, captionCoverage } : {})
  }, { outputLanguage: 'zh-CN', noteEvidencePolicy }).userPrompt.split(delimiter)[1]);
  if (field.prompt !== expected.template.fields[0].prompt || field.label !== expected.template.fields[0].label) fail('NOTE011_GUIDANCE_MISMATCH');
  return { fieldId: field.id, template, noteEvidencePolicy, document: { sourceKind: 'html-canonical', records }, coverage: coverage(records, article), captionCoverage, documentHash: records[0].documentHash,
    promptCharacters: text.length, evidenceCharacters: text.slice(0, split).length, paragraphIds: [...ids] };
}

export function inspectSavedField(fieldId, value, call, api, documentHash) {
  if (!value || call?.validated?.statuses?.[fieldId] !== 'supported' || !call.htmlSources?.sourcesSaved ||
      call.htmlSources.value !== value) fail('NOTE011_SAVED_VALUE_NOT_FROM_VALIDATED_RESPONSE');
  const projection = api.projectLiteratureNoteSources(value), sourceIds = call.validated.sources[fieldId];
  const persisted = new Set(projection.references?.flatMap(ref => ref.sourceIds) || []);
  if (!projection.ok || call.documentHash !== documentHash || sourceIds.some(id => !persisted.has(id)) ||
      [...persisted].some(id => !call.paragraphIds.includes(id))) fail('NOTE011_SAVED_SOURCE_BINDING');
  return { kind: 'html-canonical-reference', documentHash, sourceIds, persistedSourceIds: [...persisted],
    boundary: 'Saved source IDs match this document and its observed request; this is not a scientific quote or claim verification.' };
}

export function inspectGeneratedField(fieldId, previousValue, value, calls, api, documentHash) {
  const attempts = calls.filter(call => call.fieldId === fieldId);
  const supported = attempts.filter(call => call.validated?.statuses?.[fieldId] === 'supported');
  if (attempts.length && !supported.length && value === previousValue) {
    const error = new Error('NOTE011_GENERATION_FAILED');
    error.code = 'NOTE011_GENERATION_FAILED';
    error.details = { fieldId, previousValueUnchanged: true, attempts: attempts.map(call => ({
      sequence: call.sequence, httpStatus: call.status, finishReason: call.finishReason,
      validation: call.validation || null, validationErrorCode: call.validationErrorCode || null,
      schemaEvidence: call.schemaEvidence || null
    })) };
    throw error;
  }
  const call = supported.findLast(candidate => candidate.htmlSources?.sourcesSaved && candidate.htmlSources.value === value);
  return { call, evidence: inspectSavedField(fieldId, value, call, api, documentHash) };
}

export function assertPreservedSiblings(before, after, fieldId) {
  for (const table of ['valuesByTemplate', 'fieldStatusByTemplate', 'fieldEvidenceByTemplate', 'fieldUpdatedAtByTemplate']) {
    const omitTarget = state => { const value = JSON.parse(JSON.stringify(state[table] || {}));
      if (value.basic_research) {
        delete value.basic_research[fieldId];
        if (Object.keys(value.basic_research).length === 0) delete value.basic_research;
      }
      return value; };
    assert.deepEqual(omitTarget(after), omitTarget(before), `Unrelated ${table} changed`);
  }
}

export function inspectReopenedNoteState(before, after, api) {
  const isRecord = value => value !== null && typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const differences = (left, right, base = '', leftPresent = true, rightPresent = true) => {
    if (leftPresent === rightPresent && isDeepStrictEqual(left, right)) return [];
    if (leftPresent && rightPresent && isRecord(left) && isRecord(right)) {
      return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key =>
        differences(left[key], right[key], `${base}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
          Object.hasOwn(left, key), Object.hasOwn(right, key)));
    }
    return [{ path: base, before: { present: leftPresent, ...(leftPresent ? { value: left } : {}) },
      after: { present: rightPresent, ...(rightPresent ? { value: right } : {}) } }];
  };
  const rawDifferences = differences(before, after);
  // Only this representation difference was proven by normalize(reconcile(s,s)).
  // Keep raw comparison as well: the production normalizer drops unknown data.
  const empty = side => side.present && isRecord(side.value) && Object.keys(side.value).length === 0;
  const allowed = d => d.path === '/fieldEvidenceByTemplate/basic_research' &&
    ((!d.before.present && empty(d.after)) || (!d.after.present && empty(d.before)));
  return { rawDifferences, allowedEmptyContainerDifferences: rawDifferences.filter(allowed),
    unexpectedRawDifferences: rawDifferences.filter(d => !allowed(d)),
    normalizedDifferences: differences(api.normalizeLiteratureNoteDocumentState(before),
      api.normalizeLiteratureNoteDocumentState(after)) };
}

export function assertReopenedNoteState(comparison) {
  assert.deepEqual(comparison.unexpectedRawDifferences, [], 'Reopened state changed beyond the proven empty evidence container');
  assert.deepEqual(comparison.normalizedDifferences, [], 'Production-normalized reopened state changed');
}

// Definition forms are a presence heuristic, never a scientific truth check.
function inspectConceptDefinitions(value) {
  const studyStatement = /(?:本研究|这项研究|我们(?:发现|观察|证明)|研究(?:发现|结果)|实验(?:结果|发现)|^(?:结果|Results?\b)|this study\b|our (?:study|results|findings)\b|we (?:found|showed|observed)\b)/iu;
  const candidates = String(value).split(/\r?\n/u).filter(line => /^\s*[-*+]\s+\S/u.test(line))
    .map(line => line.replace(/^\s*[-*+]\s+/u, '').replace(/\*\*/gu, ''));
  const definitions = candidates.filter(line => !studyStatement.test(line) &&
    /^.{1,100}?(?:[：:—–]\s*|\s*(?:是指|指的是|是|指)\s*|\s+(?:is|are|refers? to|means?)\s+)\S.+$/iu.test(line));
  return { candidateCount: definitions.length, semanticReview: 'required' };
}

export function inspectStructure(fieldId, value, article, sentCoverage) {
  const issues = [], text = String(value || ''), lines = text.split(/\r?\n/u), bullets = lines.filter(l => /^\s*[-*+]\s+\S/u.test(l));
  if (fieldId === 'research_background') {
    const headings = ['关键概念', '现状与已知', '未知与矛盾'];
    const actual = lines.map(l => l.trim()).filter(l => /^\*\*[^*]+\*\*$/u.test(l)).map(l => l.slice(2, -2));
    if (JSON.stringify(actual) !== JSON.stringify(headings)) issues.push('BACKGROUND_HEADINGS_ORDER');
    if (headings.some((h, i) => { const start = text.indexOf(`**${h}**`), next = i + 1 < headings.length ? text.indexOf(`**${headings[i + 1]}**`) : text.length;
      return start < 0 || next <= start || !/^\s*[-*+]\s+\S/mu.test(text.slice(start, next)); })) issues.push('BACKGROUND_SECTION_BULLETS');
    const first = text.indexOf('**关键概念**'), second = text.indexOf('**现状与已知**');
    const definitionReview = inspectConceptDefinitions(first >= 0 && second > first ? text.slice(first, second) : '');
    if (!definitionReview.candidateCount) issues.push('CONCEPT_DEFINITIONS_MISSING');
    if (!bullets.length) issues.push('BULLETS_MISSING');
    return { fieldId, issues, headings: actual, bullets: bullets.length, definitionReview, scientificReview: 'Definitions, logical progression and distinction of unknowns from contradictions require source review.' };
  }
  const top = lines.filter(l => /^[-*+]\s+\S/u.test(l));
  const labels = [];
  let supplementaryContainer = false, allowedSummary = false;
  for (const line of lines) {
    if (/^[-*+]\s+\S/u.test(line)) {
      const title = line.replace(/^[-*+]\s+/u, '').replace(/\*\*/gu, '');
      supplementaryContainer = /^(?:补充图(?:（按原编号）)?|supplementary figures)\s*[：:]?\s*$/iu.test(title);
      if (supplementaryContainer) continue;
      if (!labels.length && !allowedSummary && /^(?:摘要总结|summary)\s*[：:]/iu.test(title)) {
        allowedSummary = true; continue;
      }
    } else if (!(supplementaryContainer && /^  [-*+]\s+(?:\*\*)?(?:figure\s+S|图\s*S)\d/iu.test(line))) {
      continue;
    }
    // A conclusion may mention another Figure after the heading delimiter;
    // only the leading label names this group. Full-text IDs are checked below.
    const heading = line.trimStart().replace(/^[-*+]\s+/u, '').replace(/\*\*/gu, '').split(/[：:]/u, 1)[0];
    labels.push(/^(?:(?:figures?|figs?)\.?\s*|(?:补充|补)?图\s*)S?\d/iu.test(heading) ? figureIds(heading) : []);
  }
  if (!top.length || labels.some(ids => ids.length !== 1)) issues.push('FIGURE_TOP_LEVEL_STRUCTURE');
  // Identifier-only outline headings need an actual subordinate point. Its
  // status as a supported conclusion (rather than a method) still needs review.
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^[-*+]\s+(?:\*\*)?(?:(?:figure|fig)\.?\s*|图\s*)S?\d+(?:\*\*)?\s*$/iu.test(lines[i])) continue;
    const next = lines.slice(i + 1).find(line => line.trim());
    if (!next || !/^\s+[-*+]\s+\S/u.test(next)) issues.push('FIGURE_CONCLUSION_MISSING');
  }
  const actual = figureIds(text), allowed = new Set(article.figures.map(f => f.label.replace(/^Figure\s+/u, '')));
  if (actual.some(id => !allowed.has(id))) issues.push('INVENTED_FIGURE_ID');
  const grounded = new Set([...sentCoverage.fullCaptions, ...sentCoverage.partialCaptions, ...sentCoverage.mentionedFigures]);
  if (actual.some(id => !grounded.has(id))) issues.push('FIGURE_NOT_IN_SENT_EVIDENCE');
  const ordered = labels.flat();
  const topLevelFigures = labels.filter(ids => ids.length === 1).flat();
  const omittedSentFullCaptions = [...new Set(sentCoverage.fullCaptions)].filter(id => !topLevelFigures.includes(id));
  if (omittedSentFullCaptions.length) issues.push('SENT_FULL_CAPTION_GROUP_MISSING');
  if (new Set(ordered).size !== ordered.length) issues.push('DUPLICATE_FIGURE_GROUP');
  for (const supplementary of [false, true]) {
    const group = ordered.filter(id => id.startsWith('S') === supplementary).map(id => Number(id.replace('S', '')));
    if (group.some((n, i) => i && n < group[i - 1])) issues.push('FIGURE_ORDER');
  }
  return { fieldId, issues, figureGroups: ordered, bullets: bullets.length,
    omittedSentFullCaptions, omittedArticleFigures: [...allowed].filter(id => !topLevelFigures.includes(id)),
    scientificReview: 'Figure existence and mention binding are checked; conclusion accuracy (including conclusions rather than methods lists), Panel support and inference boundaries require manual source review.' };
}

export function classifyStructureResult(fields) {
  if (fields.length !== FIELDS.length || !FIELDS.every(id => fields.some(f => f.fieldId === id)) || fields.some(f => f.issues.length)) return 'FAIL_STRUCTURE';
  return fields.find(f => f.fieldId === 'main_findings').sourceCoverage.fullFigureCaptionCoverage
    ? 'PASS_STRUCTURE_REVIEW_REQUIRED' : 'PARTIAL_SOURCE_COVERAGE';
}

export async function loadCredential(args, deps = {}) {
  let secret, metadata;
  if (args.portableConfig) {
    const p = await (deps.loadProfile || loadLivePortableProfile)(args.portableConfig, args.profile,
      args.profileModelOverride ? {} : { expectedModel: MODEL });
    let u; try { u = new globalThis.URL(p.baseUrl || 'https://api.deepseek.com'); } catch { fail('NOTE011_PROFILE_MISMATCH'); }
    if (p.providerId !== 'deepseek' || u.origin !== 'https://api.deepseek.com' || u.username || u.password || u.search || u.hash ||
        !['/', '/v1', '/v1/', '/chat/completions'].includes(u.pathname) || (p.model !== MODEL && args.profileModelOverride !== MODEL)) fail('NOTE011_PROFILE_MISMATCH');
    secret = p.apiKey; metadata = { mode: 'portable hidden TTY; memory-only key', sourceSha256: p.sourceSha256, savedModel: p.model, requestedModel: MODEL, explicitModelOverride: args.profileModelOverride || null };
  } else { secret = await (deps.readSecret || readSecretFromTty)({ prompt: 'DeepSeek API key for NOTE-011 (hidden): ' }); metadata = { mode: 'hidden TTY; memory-only key', requestedModel: MODEL }; }
  if (typeof secret !== 'string' || !secret.trim() || /[\r\n]/u.test(secret)) fail('NOTE011_CREDENTIAL_INVALID');
  const result = { metadata }; Object.defineProperty(result, 'secret', { value: secret, enumerable: false }); return result;
}

export function createForwarder({ article, api, secret, callCap, timeoutMs, signal, fetchImpl = createCurlFetch({ timeoutMs }), record = () => {} }) {
  if (!Number.isSafeInteger(callCap) || callCap < 1 || callCap > 8 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) fail('NOTE011_TRANSPORT_LIMIT');
  let calls = 0, enabled = true;
  return { get calls() { return calls; }, disable() { enabled = false; }, async forward(text) {
    if (!enabled || signal?.aborted) fail('NOTE011_PROVIDER_DISABLED');
    if (Buffer.byteLength(text) > MAX_BYTES) fail('NOTE011_REQUEST_TOO_LARGE');
    let body; try { body = JSON.parse(text); } catch { fail('NOTE011_REQUEST_INVALID'); }
    const inspected = inspectRequest(body, article, api);
    if (calls >= callCap) fail('NOTE011_CALL_CAP');
    const entry = { sequence: ++calls, fieldId: inspected.fieldId, coverage: inspected.coverage, captionCoverage: inspected.captionCoverage,
      noteEvidencePolicy: inspected.noteEvidencePolicy, documentHash: inspected.documentHash,
      paragraphIds: inspected.paragraphIds, promptCharacters: inspected.promptCharacters,
      requestedOutputCap: Number.isSafeInteger(body.max_tokens) ? body.max_tokens : null, status: null };
    record(entry, { request: text });
    try {
      const response = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: text,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
      const parts = []; let size = 0;
      for await (const part of response.body) { size += part.length; if (size > 16 * 1024 * 1024) fail('NOTE011_RESPONSE_TOO_LARGE'); parts.push(Buffer.from(part)); }
      const bytes = Buffer.concat(parts);
      if (secret && bytes.includes(Buffer.from(secret))) fail('NOTE011_RESPONSE_SECRET');
      Object.assign(entry, { status: response.status, responseBytes: bytes.length, responseSha256: hash(bytes) });
      try { const envelope = JSON.parse(bytes.toString('utf8'));
        entry.finishReason = envelope.choices?.[0]?.finish_reason;
        const raw = api.parseJsonText(envelope.choices[0].message.content);
        const rawSources = raw?.sources?.[inspected.fieldId], rawValue = raw?.values?.[inspected.fieldId];
        const allowedSources = new Set(inspected.paragraphIds);
        entry.schemaEvidence = { fieldId: inspected.fieldId,
          valueCharacters: typeof rawValue === 'string' ? rawValue.length : null,
          sourceCount: Array.isArray(rawSources) ? rawSources.length : null,
          distinctSourceCount: Array.isArray(rawSources) ? new Set(rawSources.filter(id => typeof id === 'string')).size : null,
          sourceLimit: inspected.noteEvidencePolicy.maxSources,
          unknownSourceCount: Array.isArray(rawSources) ? rawSources.filter(id => typeof id !== 'string' || !allowedSources.has(id.normalize('NFC').trim())).length : null,
          status: ['supported', 'missing'].includes(raw?.statuses?.[inspected.fieldId]) ? raw.statuses[inspected.fieldId] : null };
        const result = api.validateLiteratureNoteAutofillResponse(raw, inspected.template, inspected.document, { noteEvidencePolicy: inspected.noteEvidencePolicy });
        entry.validated = JSON.parse(JSON.stringify(result)); entry.finishReason = envelope.choices[0].finish_reason;
        if (result.statuses[inspected.fieldId] === 'supported') entry.htmlSources = api.prepareLiteratureNoteHtmlSources({
          value: result.values[inspected.fieldId], sourceIds: result.sources[inspected.fieldId], documentHash: inspected.documentHash,
          template: inspected.template, noteEvidencePolicy: inspected.noteEvidencePolicy,
          receipt: { documentHash: inspected.documentHash, noteEvidencePolicyId: inspected.noteEvidencePolicy.id, records: inspected.document.records }
        });
      } catch (error) { entry.validation = 'not-valid-as-received; unchanged response returned for production handling'; entry.validationErrorCode = safeCode(error); }
      record(entry, { response: bytes.toString('utf8') });
      return { status: response.status, contentType: response.headers.get('content-type') || 'application/json', bytes };
    } catch (error) { entry.errorCode = safeCode(error); record(entry, {}); throw error; }
  } };
}

export function preflight(article, api) {
  const body = article.paragraphs.map(p => ({ paragraphId: p.id, sourceKey: p.id, text: p.text, sectionTitle: p.section }));
  const captions = article.figures.map(f => ({ paragraphId: f.sourceId, sourceKey: f.sourceId, text: `${f.label}. ${f.title} ${f.caption}`,
    recordType: 'figure-caption', sectionKind: 'figure', sectionTitle: f.label }));
  const template = api.normalizeLiteratureNoteTemplates().find(t => t.id === 'basic_research');
  const requests = FIELDS.map(id => { const selected = { ...template, fields: template.fields.filter(f => f.id === id) };
    const noteEvidencePolicy = api.resolveLiteratureNoteEvidencePolicy(selected, { sourceKind: 'html-canonical' });
    const document = api.buildResearchEvidenceDocument({ sourceKind: 'html-canonical', title: article.title, documentHash: article.sourceSha256,
      paragraphs: [...body, ...(noteEvidencePolicy.captionFirst ? captions : [])] }, {
        maxCharacters: noteEvidencePolicy.captionFirst ? 128000 : 36000, noteEvidencePolicy
      });
    const prompt = api.compileLiteratureNoteAutofillPrompt(selected, document, { outputLanguage: 'zh-CN', noteEvidencePolicy });
    const inspected = inspectRequest({ model: MODEL, stream: false, messages: [{ role: 'user', content: prompt.userPrompt }] }, article, api);
    return { fieldId: id, noteEvidencePolicy, captionCoverage: document.captionCoverage || null, coverage: inspected.coverage,
      promptCharacters: prompt.userPrompt.length, evidenceCharacters: document.characterCount }; });
  return { status: 'PREFLIGHT_READY', realApiCalls: 0, browserCalls: 0, credentialRead: false, paragraphCount: article.paragraphs.length, figureCount: article.figures.length,
    requests, boundary: 'Production pure compiler over source projection, not actual content extraction or live output. Actual outbound coverage is rechecked before every live call.' };
}

function articleHtml(article) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + html(article.title) + '</title><link rel="canonical" href="' + html(article.url) + '"></head><body><article><h1>' + html(article.title) + '</h1>' +
    article.paragraphs.map(p => `<section><h2>${html(p.section)}</h2><p id="${html(p.id)}">${html(p.text)}</p></section>`).join('\n') +
    article.figures.map(f => `<figure id="${html(f.sourceId)}"><img src="${html(f.publicImageUrl)}"><figcaption>${html(f.label)}. ${html(f.title)} ${html(f.caption)}</figcaption></figure>`).join('\n') + '</article></body></html>';
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArguments(argv), extensionRoot = path.resolve(args.extensionRoot || root), article = loadSource(args.article, args.sourceManifest), api = loadProduction(extensionRoot);
  const report = { taskId: 'NOTE-011', model: MODEL, sourceSha256: article.sourceSha256, manifestSha256: article.manifestSha256,
    preflight: preflight(article, api), status: 'PREFLIGHT_READY', phase: 'preflight', sourceHashes: Object.fromEntries(PURE_FILES.map(file => [file, hash(fs.readFileSync(path.join(extensionRoot, file)))])), realApiCalls: 0, providerCalls: [], fields: [], checks: [],
    scientificCompleteness: 'Requires review of actual generated claims against supplied source; no automatic scientific PASS.' };
  const base = path.resolve(args.outputDir || path.join(root, 'output/playwright/note011-live'));
  fs.mkdirSync(base, { recursive: true }); const output = fs.mkdtempSync(path.join(base, args.live ? 'run-' : 'preflight-')); report.output = output;
  const write = (name, value, secret = '') => { const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2); fs.writeFileSync(path.join(output, name), sanitizedReplay(secret ? raw.split(secret).join('[REDACTED_SECRET]') : raw)); };
  write('report.json', report);
  if (!args.live) return report; // No profile, TTY, curl or browser is touched above this boundary.
  let secret = '', context, panel, worker, paper, server, completed, reopenedCaptured = false;
  const snapshot = () => panel.evaluate(() => ({
    state: typeof literatureNoteDocumentState === 'undefined' ? null : structuredClone(literatureNoteDocumentState),
    templates: typeof literatureNoteTemplates === 'function' ? structuredClone(literatureNoteTemplates()) : null,
    documentHash: typeof currentWorkspaceSnapshot === 'undefined' ? null : currentWorkspaceSnapshot?.documentHash
  }));
  const controller = new AbortController(); let end, timer;
  const remaining = () => { if (controller.signal.aborted || Date.now() >= end) fail('NOTE011_DEADLINE'); return end - Date.now(); };
  const persist = () => write('report.json', report, secret);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-note011-live-')), extension = path.join(temporary, 'extension'), profile = path.join(temporary, 'profile');
  report.isolatedProfile = profile;
  const dummy = 'note011-local-' + crypto.randomBytes(20).toString('hex');
  controller.signal.addEventListener('abort', () => { context?.close().catch(() => {}); server?.closeAllConnections(); }, { once: true });
  try {
    report.phase = 'credential'; persist();
    const credential = await loadCredential(args); secret = credential.secret; report.credential = credential.metadata;
    end = Date.now() + args.deadlineMs; timer = setTimeout(() => controller.abort(), args.deadlineMs);
    report.limits = { callCap: args.callCap, providerTimeoutMs: args.providerTimeoutMs, deadlineMs: args.deadlineMs, deadlineStarts: 'after hidden TTY input' };
    remaining();
    const forwarder = createForwarder({ article, api, secret, callCap: args.callCap, timeoutMs: args.providerTimeoutMs, signal: controller.signal,
      record(entry, artifacts) { report.realApiCalls = forwarder.calls; report.providerCalls[entry.sequence - 1] = entry;
        for (const [kind, value] of Object.entries(artifacts)) write(`provider-${entry.sequence}-${kind}-redacted.json`, value, secret); persist(); } });
    server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      try {
        if (req.method !== 'POST' || req.url !== '/chat/completions' || req.headers.authorization !== `Bearer ${dummy}`) fail('NOTE011_PROXY_REJECTED');
        const parts = []; let size = 0; for await (const part of req) { size += part.length; if (size > MAX_BYTES) fail('NOTE011_REQUEST_TOO_LARGE'); parts.push(part); }
        const result = await forwarder.forward(Buffer.concat(parts).toString('utf8'));
        res.writeHead(result.status, { 'Content-Type': result.contentType }); res.end(result.bytes);
      } catch (error) { report.boundaryErrorCode = safeCode(error); persist(); res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: safeCode(error) } })); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const proxy = `http://127.0.0.1:${server.address().port}`;
    fs.mkdirSync(extension); for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(extensionRoot, dir), path.join(extension, dir), { recursive: true });
    for (const file of fs.readdirSync(extensionRoot)) if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(extensionRoot, file), path.join(extension, file));
    const collect = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) collect(f); else if (/\.(js|mjs|html|css|json)$/u.test(f)) report.sourceHashes[path.relative(extension, f).replaceAll('\\', '/')] = hash(fs.readFileSync(f)); } }; collect(extension);
    const network = path.join(extension, 'offscreen-network-worker.js');
    fs.writeFileSync(network, `const note011Fetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(url,options)=>{if(String(url)!==${JSON.stringify(ENDPOINT)})throw Error('NOTE011_REMOTE_BLOCKED');return note011Fetch(${JSON.stringify(proxy + '/chat/completions')},options);};\n` + fs.readFileSync(network, 'utf8'));
    report.boundary = 'Only temporary offscreen HTTP transport redirects to a transparent bounded proxy; production prompts, validation and UI handlers are unchanged.';
    const { chromium } = await import('playwright');
    report.phase = 'isolated-browser'; persist();
    context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: !args.headed, reducedMotion: 'reduce', timeout: Math.min(remaining(), 30000), args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    context.setDefaultTimeout(Math.min(remaining(), 30000));
    await context.route(/^https?:\/\//u, route => { const url = route.request().url();
      if (url === article.url) return route.fulfill({ contentType: 'text/html', body: articleHtml(article) });
      const figure = article.figures.find(f => f.publicImageUrl === url); if (figure) return route.fulfill({ contentType: 'image/jpeg', body: figure.imageBytes });
      return url.startsWith(proxy + '/') ? route.continue() : route.abort('blockedbyclient'); });
    paper = context.pages()[0] || await context.newPage(); await paper.goto(article.url, { waitUntil: 'domcontentloaded' });
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url), article.url);
    await worker.evaluate(async t => { const activation = await SciLLM.markTabActivated(chrome.storage.session, t); await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {}); }, tab);
    const popupUrl = `chrome-extension://${new globalThis.URL(worker.url()).host}/popup.html`;
    const openPanel = async () => { panel = await context.newPage(); await panel.setViewportSize({ width: 620, height: 960 }); await panel.goto(popupUrl, { waitUntil: 'domcontentloaded' }); await paper.bringToFront();
      await panel.waitForFunction(title => document.getElementById('sidePanelPaperTitle')?.textContent === title, article.title);
      await panel.evaluate(async () => { await loadLlmSettings(); await refreshArticleWorkspace(); switchWorkspaceView('notes'); });
      await panel.waitForFunction(() => literatureNoteDocumentState?.valuesByTemplate && document.getElementById('literatureNoteTemplateSelect')?.value === literatureNoteDocumentState.templateId); };
    await openPanel();
    await panel.evaluate(async ({ dummy, model }) => { for (const message of [
      { type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_note011_live', name: 'NOTE011 live', providerId: 'deepseek', config: { apiKey: dummy, model, maxOutputTokens: 8192, reasoningEnabled: false } } },
      { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_note011_live', taskRoutes: {} },
      { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
    ]) { if (!(await chrome.runtime.sendMessage(message))?.success) throw Error('NOTE011_PROFILE_SETUP'); } await loadLlmSettings(); }, { dummy, model: MODEL });
    if (await panel.locator('#literatureNoteTemplateSelect').inputValue() !== 'basic_research') await panel.locator('#literatureNoteTemplateSelect').selectOption('basic_research');
    const saved = () => panel.waitForFunction(() => !literatureNoteAutofillPromise && !literatureNoteSaveTimer && literatureNoteDirtyRevisions.size === 0, null, { timeout: Math.min(remaining(), args.providerTimeoutMs * 4 + 30000) });
    const manual = 'NOTE011 isolated manual sibling: preserve this exact value.';
    await panel.locator('[data-literature-note-field="innovations"]').fill(manual); await saved();
    await panel.locator('[data-literature-note-field="limitations"]').fill('temporary explicit-clear control'); await saved();
    await panel.locator('[data-literature-note-field="limitations"]').fill(''); await saved();
    const before = await snapshot(); article.runtimeDocumentHash = before.documentHash;
    if (!article.runtimeDocumentHash) fail('NOTE011_DOCUMENT_NOT_READY');
    const canonical = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId },
      func: () => { const s = getCanonicalArticleSnapshot({ forceRefresh: false }); return { documentHash: s.documentHash, url: s.url,
        paragraphs: s.paragraphs, typedRecords: (s.typedRecords || []).filter(r => r.recordType === 'figure-caption') }; }
    }))[0].result, tab.id);
    if (canonical.documentHash !== article.runtimeDocumentHash || canonical.url !== article.url) fail('NOTE011_DOCUMENT_NOT_READY');
    article.runtimeParagraphs = canonical.paragraphs; article.runtimeTypedRecords = canonical.typedRecords;
    report.runtimeSourceIdentity = { documentHash: canonical.documentHash, url: canonical.url, bodyCount: canonical.paragraphs.length,
      typedCaptionCount: canonical.typedRecords.length, typedCaptionIds: canonical.typedRecords.map(r => r.paragraphId) };
    write('canonical-article-snapshot.json', canonical, secret);
    write('before-note-state.json', before, secret);
    for (const id of FIELDS) {
      report.phase = id; persist();
      const priorCalls = forwarder.calls, priorState = await snapshot();
      await panel.locator(`[data-generate-literature-note-field="${id}"]`).click(); await saved();
      if (forwarder.calls <= priorCalls) fail('NOTE011_NO_REAL_REQUEST');
      const current = await snapshot(), value = current.state.valuesByTemplate.basic_research[id];
      let call, evidence;
      try {
        ({ call, evidence } = inspectGeneratedField(id, priorState.state.valuesByTemplate.basic_research[id], value,
          report.providerCalls.slice(priorCalls), api, article.runtimeDocumentHash));
      } catch (error) {
        if (error.code === 'NOTE011_GENERATION_FAILED') report.generationFailure = error.details;
        throw error;
      }
      assertPreservedSiblings(priorState.state, current.state, id);
      report.fields.push({ ...inspectStructure(id, call.validated.values[id], article, call.coverage), valueSha256: hash(value), sources: call.validated.sources[id], evidence,
        sourceCoverage: call.coverage, captionCoverage: call.captionCoverage, noteEvidencePolicy: call.noteEvidencePolicy });
      assert.equal(current.state.valuesByTemplate.basic_research.innovations, manual);
      assert.equal(current.state.valuesByTemplate.basic_research.limitations || '', '');
      assert.equal(current.state.fieldUpdatedAtByTemplate.basic_research.limitations, before.state.fieldUpdatedAtByTemplate.basic_research.limitations);
      assert.deepEqual(current.templates, before.templates);
      const block = panel.locator('.literature-note-field').filter({ has: panel.locator(`[data-literature-note-field="${id}"]`) }), preview = block.locator('.literature-note-editor-preview');
      if (!await preview.isVisible()) { await block.locator('textarea').focus(); await block.locator('.literature-note-editor-toggle').click(); } await preview.scrollIntoViewIfNeeded();
      report.fields.at(-1).rendered = await preview.evaluate(el => ({ visible: el.checkVisibility(), listItems: el.querySelectorAll('li').length, headings: [...el.querySelectorAll('strong')].map(n => n.textContent), chars: el.textContent.length }));
      assert.ok(report.fields.at(-1).rendered.visible && report.fields.at(-1).rendered.chars > 20);
      await panel.screenshot({ path: path.join(output, `${id}.png`) }); persist();
    }
    completed = await snapshot(); write('completed-note-state.json', completed, secret);
    report.phase = 'reopen-popup'; persist();
    const callsBefore = forwarder.calls; forwarder.disable(); await panel.close(); await openPanel();
    await panel.waitForFunction(expected => JSON.stringify(literatureNoteDocumentState?.valuesByTemplate) === expected, JSON.stringify(completed.state.valuesByTemplate));
    const reopened = await snapshot(); write('reopened-note-state.json', reopened, secret); reopenedCaptured = true;
    await panel.screenshot({ path: path.join(output, 'reopened.png') });
    const comparison = inspectReopenedNoteState(completed.state, reopened.state, api);
    write('reopened-state-comparison.json', comparison, secret);
    report.reopenComparison = { rawDifferences: comparison.rawDifferences.map(d => d.path),
      allowedEmptyContainerDifferences: comparison.allowedEmptyContainerDifferences.map(d => d.path),
      unexpectedRawDifferences: comparison.unexpectedRawDifferences.map(d => d.path),
      normalizedDifferences: comparison.normalizedDifferences.map(d => d.path) }; persist();
    assertReopenedNoteState(comparison); assert.equal(reopened.documentHash, completed.documentHash);
    assert.deepEqual(reopened.templates, before.templates); assert.equal(forwarder.calls, callsBefore);
    report.reopened = true; report.reopenMode = 'new-popup-page; same-isolated-Edge-process'; report.checks.push('manual sibling and explicit clear retained', 'templates unchanged', 'two real generated fields saved with request-bound HTML source IDs', 'production-normalized state restored with only proven empty-container tolerance and no additional calls');
    report.status = classifyStructureResult(report.fields);
    report.phase = 'completed';
  } catch (error) {
    report.status = 'FAIL'; report.errorCode = safeCode(error);
    if (panel && !panel.isClosed()) {
      try {
        const observed = await snapshot(); write('failure-observed-note-state.json', observed, secret);
        if (completed && report.phase === 'reopen-popup') {
          const comparison = inspectReopenedNoteState(completed.state, observed.state, api);
          write('failure-reopened-state-comparison.json', comparison, secret);
          if (!reopenedCaptured) {
            write('reopened-note-state.json', observed, secret);
            write('reopened-state-comparison.json', comparison, secret);
          }
        }
      } catch (captureError) { report.failureSnapshotErrorCode = safeCode(captureError); }
      await panel.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {});
    }
  }
  finally {
    clearTimeout(timer); controller.abort();
    report.browserClosed = context ? await Promise.race([context.close().then(() => true, () => false), new Promise(resolve => { const t = setTimeout(() => resolve(false), 10000); t.unref(); })]) : null;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    report.sourceFilesUnchanged = Object.entries(report.sourceHashes).every(([file, digest]) => hash(fs.readFileSync(path.join(extensionRoot, file))) === digest);
    report.articleFileUnchanged = hash(fs.readFileSync(args.article)) === article.sourceSha256 && hash(fs.readFileSync(args.sourceManifest)) === article.manifestSha256;
    if (!report.sourceFilesUnchanged || !report.articleFileUnchanged) { report.status = 'FAIL'; report.errorCode = 'NOTE011_SOURCE_CHANGED'; }
    if (report.browserClosed === false) { report.status = 'FAIL'; report.cleanupErrorCode = 'NOTE011_BROWSER_NOT_CONFIRMED_CLOSED'; }
    report.temporaryArtifactsRetained = true; persist(); secret = '';
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run().then(report => {
  process.stdout.write(JSON.stringify({ status: report.status, realApiCalls: report.realApiCalls, output: report.output, errorCode: report.errorCode }) + '\n');
  if (report.status.startsWith('FAIL')) process.exitCode = 1;
}).catch(error => { process.stderr.write(safeCode(error) + '\n'); process.exitCode = 1; });
