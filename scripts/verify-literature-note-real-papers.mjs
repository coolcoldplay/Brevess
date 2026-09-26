import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
require('../core/settings-store.js');
require('../core/cache-planner.js');
require('../providers/provider-registry.js');
const {
  normalizeEndpoint: normalizeProductionEndpoint,
  resolveTaskProfile: resolveProductionTaskProfile
} = require('../core/task-profile-router.js');

export const requiredPapers = Object.freeze([
  Object.freeze({
    key: 'neuron-2026-dopamine-circuits',
    title: 'Receptor and cell-type-specific mechanisms in mesocortical dopamine circuits gate chronic pain and comorbid symptoms'
  }),
  Object.freeze({
    key: 'neuron-2020-hippocampal-ripples',
    title: 'Routing of Hippocampal Ripples to Subcortical Structures via the Lateral Septum'
  }),
  Object.freeze({
    key: 'nat-neuro-2020-srpx2',
    title: 'The endogenous neuronal complement inhibitor SRPX2 protects against complement-mediated synapse elimination during development'
  })
]);

export const requiredScreenshotKinds = Object.freeze([
  'mixed-supported-missing',
  'preserved-reader-edit',
  'completion-summary'
]);

const SENTINELS = new Set(['正文未提供', 'not provided in the article']);
const SHA256 = /^[a-f0-9]{64}$/iu;
const PRODUCTION_SIGNATURE = /^[a-f0-9]{8,64}$/iu;
const IDENTIFIER = /^(?:10\.\d{4,9}\/\S+|PMID:\s*\d+)$/iu;
const clean = (value, maximum = 500) => String(value ?? '')
  .normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maximum);
const own = (value, key) => value && Object.hasOwn(value, key);
const countShape = value => Object.fromEntries(
  ['filled', 'missing', 'preserved', 'invalid'].map(key => [key, Number(value?.[key]) || 0])
);
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function productionStableHash(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function productionSettingsFromPublic(settings) {
  return {
    ...settings,
    profiles: Object.fromEntries(Object.entries(settings.profiles || {}).map(([profileId, profile]) => {
      const config = profile?.config && typeof profile.config === 'object'
        ? profile.config : {};
      return [profileId, {
        ...profile,
        config: {
          ...config,
          ...(profile?.providerId === 'codex-local' ? {} : {
            apiKey: config.hasApiKey === true ? 'configured-profile-proof' : ''
          })
        }
      }];
    }))
  };
}

export function parseRuntimeSettingsProof(response = {}) {
  const state = response?.success === true && response.data &&
    typeof response.data === 'object' ? response.data : null;
  const settings = state?.settings;
  if (state?.llmReady !== true || !settings || typeof settings !== 'object' ||
      settings.version !== 6 || settings.consentGranted !== true || !settings.profiles ||
      typeof settings.profiles !== 'object' || !settings.taskPolicies ||
      typeof settings.taskPolicies !== 'object') return null;
  const outputLanguage = String(settings.language || '').toLowerCase().startsWith('en')
    ? 'en' : 'zh-CN';
  const allowedProviders = new Set([
    'openai', 'anthropic', 'gemini', 'deepseek', 'openai-compatible', 'codex-local'
  ]);
  const productionSettings = productionSettingsFromPublic(settings);
  const resolve = taskId => {
    const policy = settings.taskPolicies[taskId];
    if (!policy || typeof policy !== 'object' ||
        !['global', 'profile'].includes(String(policy.mode || ''))) return null;
    const profileId = policy.mode === 'profile'
      ? clean(policy.profileId, 80) : clean(settings.globalProfileId, 80);
    const profile = settings.profiles[profileId];
    const config = profile?.config;
    const providerId = clean(profile?.providerId, 80);
    const model = clean(config?.model, 300);
    if (!profileId || !profile || typeof profile !== 'object' ||
        !config || typeof config !== 'object' || !allowedProviders.has(providerId) || !model) {
      return null;
    }
    if (providerId !== 'codex-local' && config.hasApiKey !== true) return null;
    const endpoint = normalizeProductionEndpoint(config.baseUrl);
    if ((providerId === 'openai-compatible' && endpoint === 'official') || endpoint === 'invalid') {
      return null;
    }
    let routed;
    try {
      routed = resolveProductionTaskProfile(productionSettings, taskId);
    } catch { return null; }
    if (routed.effectiveProfileId !== profileId || routed.fallbackReason !== null ||
        routed.providerId !== providerId || routed.model !== model ||
        routed.capabilityMode !== 'text' ||
        !PRODUCTION_SIGNATURE.test(String(routed.profileSignature || ''))) return null;
    const receiptIdentity = {
      profileId, providerId, model, outputLanguage, endpoint,
      capabilityMode: routed.capabilityMode,
      productionProfileSignature: routed.profileSignature
    };
    return {
      profileId, providerId, model,
      requestedProfileId: policy.mode === 'profile' ? profileId : null,
      profileSignature: crypto.createHash('sha256')
        .update(JSON.stringify(receiptIdentity)).digest('hex'),
      productionProfileSignature: routed.profileSignature
    };
  };
  const normal = resolve('literature_note_autofill');
  const mechanism = resolve('cross_figure_mechanism');
  if (!normal || !mechanism) return null;
  return Object.freeze({
    profileRows: Object.freeze([
      Object.freeze({ profileRole: 'normal', profileSignature: normal.profileSignature }),
      Object.freeze({ profileRole: 'mechanism', profileSignature: mechanism.profileSignature })
    ]),
    profileId: normal.profileId,
    providerId: normal.providerId,
    requestedProfileId: normal.requestedProfileId,
    profileSignature: normal.profileSignature,
    productionProfileSignature: normal.productionProfileSignature,
    outputLanguage,
    model: normal.model
  });
}

function sourceIdentity(source) {
  return typeof source === 'string'
    ? { paragraphId: clean(source, 200), documentHash: '' }
    : {
        paragraphId: clean(source?.paragraphId, 200),
        documentHash: clean(source?.documentHash, 64).toLowerCase()
      };
}

export function auditAutofillScenario(value = {}) {
  const issues = [];
  const initial = value.initialValues && typeof value.initialValues === 'object'
    ? value.initialValues : {};
  const pending = value.pendingEdits && typeof value.pendingEdits === 'object'
    ? value.pendingEdits : {};
  const finalValues = value.finalValues && typeof value.finalValues === 'object'
    ? value.finalValues : {};
  const statuses = value.statuses && typeof value.statuses === 'object' ? value.statuses : {};
  const sources = value.sources && typeof value.sources === 'object' ? value.sources : {};
  const fields = [...new Set([
    ...Object.keys(initial), ...Object.keys(pending), ...Object.keys(finalValues),
    ...Object.keys(statuses), ...Object.keys(sources)
  ])].sort();
  const allowedParagraphIds = new Set(
    (Array.isArray(value.currentDocumentSources) ? value.currentDocumentSources : [])
      .map(item => clean(typeof item === 'string' ? item : item?.paragraphId, 200)).filter(Boolean)
  );
  const documentHash = clean(value.documentHash, 64).toLowerCase();
  const actualCounts = { filled: 0, missing: 0, preserved: 0, invalid: 0 };

  if (!SHA256.test(documentHash)) issues.push('documentHash must be a SHA-256');
  for (const fieldId of fields) {
    const before = String(initial[fieldId] ?? '');
    const hasPendingEdit = own(pending, fieldId) && String(pending[fieldId] ?? '') !== before;
    const expectedPreserved = hasPendingEdit ? String(pending[fieldId] ?? '') : before;
    const finalValue = String(finalValues[fieldId] ?? '');
    const normalizedFinal = clean(finalValue, 12000).toLowerCase();
    if (SENTINELS.has(normalizedFinal)) issues.push(`${fieldId}: sentinel must not be saved`);

    if (before || hasPendingEdit) {
      actualCounts.preserved += 1;
      if (finalValue !== expectedPreserved) {
        issues.push(`${fieldId}: preserved reader value changed`);
      }
      continue;
    }

    const status = clean(statuses[fieldId], 24).toLowerCase();
    const fieldSources = Array.isArray(sources[fieldId]) ? sources[fieldId].map(sourceIdentity) : [];
    if (status === 'missing') {
      if (finalValue !== '' || fieldSources.length !== 0) {
        issues.push(`${fieldId}: missing requires an empty value and no sources`);
        actualCounts.invalid += 1;
      } else {
        actualCounts.missing += 1;
      }
      continue;
    }
    if (status === 'supported' && clean(finalValue, 12000) && fieldSources.length > 0) {
      const currentDocumentOnly = fieldSources.every(source =>
        source.paragraphId && allowedParagraphIds.has(source.paragraphId) &&
        source.documentHash === documentHash
      );
      if (currentDocumentOnly) actualCounts.filled += 1;
      else {
        issues.push(`${fieldId}: supported sources are not all from the current document`);
        actualCounts.invalid += 1;
      }
      continue;
    }
    issues.push(`${fieldId}: invalid supported/missing field semantics`);
    actualCounts.invalid += 1;
  }

  if (!sameJson(actualCounts, countShape(value.counts))) issues.push('reported counts do not match fields');
  return Object.freeze({ ok: issues.length === 0, actualCounts, issues });
}

function replayShape(value = {}) {
  return {
    finalValues: value.finalValues || {},
    statuses: value.statuses || {},
    sources: value.sources || {},
    counts: countShape(value.counts)
  };
}

export function auditCacheReplay({ first = {}, second = {}, providerCalls = {} } = {}) {
  const firstCalls = Number(Array.isArray(providerCalls) ? providerCalls[0] : providerCalls.first);
  const secondCalls = Number(Array.isArray(providerCalls) ? providerCalls[1] : providerCalls.second);
  const identical = sameJson(replayShape(first), replayShape(second));
  const identityKeys = [
    'documentHash', 'evidenceSignature', 'templateSignature',
    'outputLanguage', 'profileSignature', 'cacheKey'
  ];
  const firstIdentity = first.requestIdentity || {};
  const secondIdentity = second.requestIdentity || {};
  const identityValid = buildProductionCacheReceipt(firstIdentity).ok;
  const sameRequestIdentity = identityValid && identityKeys.every(key =>
    String(firstIdentity[key] || '') === String(secondIdentity[key] || ''));
  const noSecondProviderCall = Number.isSafeInteger(firstCalls) && firstCalls >= 1 &&
    secondCalls === 0;
  return Object.freeze({
    ok: first.cacheHit !== true && second.cacheHit === true && identical &&
      sameRequestIdentity && noSecondProviderCall,
    identical, sameRequestIdentity,
    noSecondProviderCall
  });
}

export function buildProductionCacheReceipt(value = {}) {
  const identity = {
    documentHash: clean(value.documentHash, 64).toLowerCase(),
    evidenceSignature: clean(value.evidenceSignature, 64).toLowerCase(),
    templateSignature: clean(value.templateSignature, 64).toLowerCase(),
    outputLanguage: clean(value.outputLanguage, 20),
    profileSignature: clean(value.profileSignature, 64).toLowerCase(),
    cacheKey: clean(value.cacheKey, 96)
  };
  const ok = Boolean(identity.outputLanguage) &&
    SHA256.test(identity.documentHash) && PRODUCTION_SIGNATURE.test(identity.profileSignature) &&
    PRODUCTION_SIGNATURE.test(identity.evidenceSignature) &&
    PRODUCTION_SIGNATURE.test(identity.templateSignature) &&
    /^literature-note:[a-f0-9]{8,64}$/iu.test(identity.cacheKey);
  return Object.freeze({ ok, identity: Object.freeze(identity) });
}

export function auditSourceCitations({ sources = {}, records = [], documentHash = '' } = {}) {
  const recordMap = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const paragraphId = clean(record?.paragraphId, 200);
    const sourceIdentity = clean(record?.sourceIdentity, 300);
    const textHash = clean(record?.textHash, 64).toLowerCase();
    if (paragraphId && sourceIdentity && PRODUCTION_SIGNATURE.test(textHash) &&
        !recordMap.has(paragraphId)) {
      recordMap.set(paragraphId, { paragraphId, sourceIdentity, textHash });
    }
  }
  const normalizedSources = {};
  const citations = {};
  const issues = [];
  for (const [fieldId, sourceIds] of Object.entries(sources || {})) {
    normalizedSources[fieldId] = [];
    citations[fieldId] = [];
    for (const rawId of Array.isArray(sourceIds) ? sourceIds : []) {
      const paragraphId = clean(rawId, 200);
      const receipt = recordMap.get(paragraphId);
      if (!receipt) {
        issues.push(`${clean(fieldId, 100)}: source is absent from current-document receipt`);
        continue;
      }
      normalizedSources[fieldId].push({ paragraphId, documentHash });
      citations[fieldId].push(receipt);
    }
  }
  return Object.freeze({
    ok: SHA256.test(String(documentHash || '')) && issues.length === 0,
    sources: normalizedSources,
    citations,
    currentDocumentSources: [...recordMap.keys()],
    issues
  });
}

function comparableProductionResponse(response = {}) {
  const data = response.data || response.result || response;
  return {
    values: data.values || {},
    statuses: data.statuses || data.fieldStatus || {},
    sources: data.sources || {},
    templateId: clean(data.templateId, 100),
    documentHash: clean(data.documentHash, 64)
  };
}

export async function runTwoOperationBoundary({
  invoke, onSecondStarted, applySecond
} = {}) {
  if (typeof invoke !== 'function' || typeof applySecond !== 'function') {
    throw new Error('LITERATURE_NOTE_BOUNDARY_INVALID');
  }
  const first = await invoke({ expectedCacheHit: false });
  const secondPromise = invoke({ expectedCacheHit: true });
  if (typeof onSecondStarted === 'function') await onSecondStarted();
  const second = await secondPromise;
  const firstData = first?.data || first?.result || first || {};
  const secondData = second?.data || second?.result || second || {};
  const firstReceipt = firstData.operationReceipt || {};
  const secondReceipt = secondData.operationReceipt || {};
  if (!first?.success || !second?.success || firstData.cacheHit === true ||
      secondData.cacheHit !== true || !sameJson(
        comparableProductionResponse(first), comparableProductionResponse(second)
      ) || !clean(firstData.operationId, 100) || !clean(secondData.operationId, 100) ||
      firstReceipt.operationId !== firstData.operationId ||
      secondReceipt.operationId !== secondData.operationId ||
      !Number.isSafeInteger(firstReceipt.providerAttempts) || firstReceipt.providerAttempts < 1 ||
      firstReceipt.cacheHit !== false || secondReceipt.providerAttempts !== 0 ||
      secondReceipt.cacheHit !== true ||
      !sameJson(firstReceipt.cacheIdentity, secondReceipt.cacheIdentity)) {
    throw new Error('LITERATURE_NOTE_TWO_OPERATION_MISMATCH');
  }
  await applySecond(second);
  return {
    first, second,
    providerCalls: { first: firstReceipt.providerAttempts, second: 0 },
    appliedOperationId: clean(secondData.operationId, 100)
  };
}

export function projectAuditedPapers(papers = []) {
  return (Array.isArray(papers) ? papers : []).map(paper => ({
    ...paper,
    scenarios: (Array.isArray(paper?.scenarios) ? paper.scenarios : []).map(scenario => {
      const audit = auditAutofillScenario(scenario);
      const mismatchSatisfied = scenario?.expectedMismatch !== true || audit.actualCounts.missing > 0;
      return { ...scenario, pass: audit.ok && mismatchSatisfied };
    })
  }));
}

export function auditProfileCoverage(scenarios = []) {
  const rows = Array.isArray(scenarios) ? scenarios : [];
  const normal = rows.filter(item => item?.profileRole === 'normal');
  const mechanism = rows.filter(item => item?.profileRole === 'mechanism');
  const signatureRows = [...normal, ...mechanism]
    .map(item => clean(item?.profileSignature, 64).toLowerCase());
  const signatures = new Set(signatureRows);
  const allValid = signatureRows.length === normal.length + mechanism.length &&
    signatureRows.every(value => SHA256.test(value));
  return Object.freeze({
    ok: normal.length > 0 && mechanism.length > 0 && allValid && signatures.size === 1,
    normalRuns: normal.length,
    mechanismRuns: mechanism.length,
    sameProfile: signatures.size === 1
  });
}

export function validatePrivateManifest(value = {}) {
  const issues = [];
  const topLevelKeys = value && typeof value === 'object' ? Object.keys(value) : [];
  if (topLevelKeys.some(key => key !== 'papers')) {
    issues.push('manifest may contain only paper authorization and expectations');
  }
  const papers = Array.isArray(value.papers) ? value.papers : [];
  for (const required of requiredPapers) {
    const paper = papers.find(candidate => candidate?.key === required.key);
    if (!paper) {
      issues.push(`missing ${required.key}`);
      continue;
    }
    if (clean(paper.title, 500).toLowerCase() !== required.title.toLowerCase()) {
      issues.push(`${required.key}: title mismatch`);
    }
    if (!IDENTIFIER.test(clean(paper.identifier, 200))) {
      issues.push(`${required.key}: DOI or PMID identifier required`);
    }
    if (!SHA256.test(String(paper.sha256 || ''))) issues.push(`${required.key}: SHA-256 required`);
    try {
      const url = new URL(String(paper.articleUrl || ''));
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
    } catch (_) { issues.push(`${required.key}: http(s) articleUrl required`); }
    const mismatch = clean(paper.mismatchedTemplateId, 100);
    if (!/^[a-z][a-z0-9_]*$/u.test(mismatch) || mismatch === 'basic_research') {
      issues.push(`${required.key}: mismatched template ID required`);
    }
    if (paper.authorized !== true) issues.push(`${required.key}: explicit authorization required`);
    const forbiddenClaims = [
      'scenarios', 'finalValues', 'statuses', 'sources', 'counts', 'pass', 'cacheHit',
      'providerCalls', 'screenshotCaptures'
    ];
    if (forbiddenClaims.some(key => Object.hasOwn(paper, key))) {
      issues.push(`${required.key}: private input must not contain result claims`);
    }
  }
  if (papers.length !== requiredPapers.length) issues.push('manifest must contain exactly three papers');
  return Object.freeze({ ok: issues.length === 0, issues });
}

export function auditScenarioMatrix(scenarios = []) {
  const rows = Array.isArray(scenarios) ? scenarios : [];
  const basic = rows.find(row => row?.templateId === 'basic_research');
  const mismatch = rows.find(row => row?.expectedMismatch === true &&
    clean(row?.templateId, 100) !== 'basic_research');
  const basicCounts = countShape(basic?.counts);
  const mismatchCounts = countShape(mismatch?.counts);
  const ok = Boolean(basic && mismatch) && basicCounts.filled > 0 &&
    mismatchCounts.filled > 0 && mismatchCounts.missing > 0 &&
    basicCounts.invalid === 0 && mismatchCounts.invalid === 0;
  return Object.freeze({ ok, basicCounts, mismatchCounts });
}

export function auditNativeInspection({ headedEdge = false, captures = [], reviews = {} } = {}) {
  const issues = [];
  const rows = Array.isArray(captures) ? captures : [];
  if (headedEdge !== true) issues.push('capture must run in headed Edge');
  for (const kind of requiredScreenshotKinds) {
    const capture = rows.find(item => item?.kind === kind);
    if (!capture) {
      issues.push(`${kind}: capture missing`);
      continue;
    }
    const filename = path.basename(clean(capture.filename, 200));
    const review = reviews && typeof reviews === 'object' ? reviews[filename] : null;
    const edgeCapture = clean(capture.browserName, 40).toLowerCase() === 'msedge';
    let liveEvidence = null;
    try {
      liveEvidence = screenshotEvidenceFromFile(capture.absolutePath, capture.kind);
    } catch (_) { liveEvidence = null; }
    const liveBound = liveEvidence && liveEvidence.filename === filename &&
      liveEvidence.sha256 === capture.sha256 && liveEvidence.width === capture.width &&
      liveEvidence.height === capture.height;
    const bound = liveBound && SHA256.test(String(capture.sha256 || '')) &&
      clean(review?.sha256, 64).toLowerCase() === String(capture.sha256).toLowerCase() &&
      Number(review?.width) === Number(capture.width) &&
      Number(review?.height) === Number(capture.height);
    const checks = review?.checks || {};
    const inspected = review?.status === 'PASS' && review?.nativeResolution === true &&
      clean(review?.observation, 500) && bound && edgeCapture &&
      ['missingTextareasEmpty', 'statusVisible', 'spacingReadable', 'noOverlayObstruction']
        .every(key => checks[key] === true);
    if (!inspected) issues.push(`${filename}: native inspection missing or mismatched`);
  }
  return Object.freeze({ ok: issues.length === 0, issues });
}

function publicScenario(value = {}) {
  return {
    templateId: clean(value.templateId, 100),
    counts: countShape(value.counts),
    pass: value.pass === true
  };
}

function publicPaper(value = {}) {
  return {
    key: clean(value.key, 100),
    title: clean(value.title, 500),
    identifier: IDENTIFIER.test(clean(value.identifier, 200)) ? clean(value.identifier, 200) : '',
    sha256: SHA256.test(String(value.sha256 || '')) ? String(value.sha256).toLowerCase() : '',
    scenarios: (Array.isArray(value.scenarios) ? value.scenarios : []).map(publicScenario)
  };
}

export function buildPublicReport(value = {}) {
  const papers = (Array.isArray(value.papers) ? value.papers : []).map(publicPaper);
  const security = {
    secretScanPassed: value.security?.secretScanPassed === true,
    outputAllowlistPassed: value.security?.outputAllowlistPassed === true
  };
  const passed = papers.length === requiredPapers.length && papers.every(paper =>
    paper.scenarios.length >= 2 && paper.scenarios.every(scenario => scenario.pass)) &&
    security.secretScanPassed && security.outputAllowlistPassed;
  const requestedStatus = clean(value.status, 40);
  return {
    schemaVersion: 1,
    status: requestedStatus.startsWith('PENDING_EXTERNAL_INPUT')
      ? requestedStatus : (passed && requestedStatus !== 'FAIL' ? 'PASS' : 'FAIL'),
    papers,
    security
  };
}

function hasExactKeys(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every(key => allowed.includes(key)) && required.every(key => keys.includes(key));
}

export function auditPublicReport(value = {}) {
  const issues = [];
  const topKeys = [
    'schemaVersion', 'status', 'papers', 'security', 'pass', 'error', 'qaStage', 'errorCode'
  ];
  if (!hasExactKeys(value, topKeys, ['schemaVersion', 'status', 'papers', 'security'])) {
    issues.push('top-level public allowlist mismatch');
  }
  if (!Array.isArray(value.papers)) issues.push('papers must be an array');
  for (const paper of Array.isArray(value.papers) ? value.papers : []) {
    if (!hasExactKeys(paper, ['key', 'title', 'identifier', 'sha256', 'scenarios'])) {
      issues.push('paper public allowlist mismatch');
    }
    if (!Array.isArray(paper?.scenarios)) issues.push('scenarios must be an array');
    for (const scenario of Array.isArray(paper?.scenarios) ? paper.scenarios : []) {
      if (!hasExactKeys(scenario, ['templateId', 'counts', 'pass'])) {
        issues.push('scenario public allowlist mismatch');
      }
      if (!hasExactKeys(scenario?.counts, ['filled', 'missing', 'preserved', 'invalid'])) {
        issues.push('counts public allowlist mismatch');
      }
    }
  }
  if (!hasExactKeys(value.security, ['secretScanPassed', 'outputAllowlistPassed'])) {
    issues.push('security public allowlist mismatch');
  }
  if (own(value, 'qaStage') || own(value, 'errorCode')) {
    const qaStage = clean(value.qaStage, 40);
    if (!Object.hasOwn(QA_ERROR_CODES, qaStage) ||
        value.errorCode !== QA_ERROR_CODES[qaStage]) {
      issues.push('diagnostic public allowlist mismatch');
    }
  }
  const serialized = JSON.stringify(value);
  const secretPatterns = [
    /\bsk-[A-Za-z0-9_-]{8,}\b/u,
    /[A-Za-z]:\\(?:Users|Documents and Settings)\\/iu,
    /\/(?:Users|home)\/[^/\s]+\//u,
    /(?:api[_-]?key|authorization|bearer)\s*[:=]\s*[^\s,"}]+/iu
  ];
  const secretScanPassed = secretPatterns.every(pattern => !pattern.test(serialized));
  if (!secretScanPassed) issues.push('serialized public report contains a sensitive value');
  const outputAllowlistPassed = !issues.some(issue => issue.includes('allowlist') ||
    issue.includes('must be an array'));
  return Object.freeze({
    ok: outputAllowlistPassed && secretScanPassed,
    outputAllowlistPassed,
    secretScanPassed,
    issues
  });
}

export function safeRuntimeFailure(error) {
  const message = clean(error?.message || error, 500);
  if (/^PENDING_EXTERNAL_INPUT: [a-z0-9 _./:-]+$/iu.test(message)) return message;
  if (/^LITERATURE_NOTE_PROVIDER_SCENARIO_FAILED:[A-Z][A-Z0-9_-]{2,80}$/u.test(message)) {
    return message;
  }
  const allowed = new Set([
    'LITERATURE_NOTE_ARTICLE_TAB_MISSING',
    'LITERATURE_NOTE_CONTENT_RECOVERY_UNAVAILABLE',
    'LITERATURE_NOTE_DRAWER_OPEN_TIMEOUT',
    'LITERATURE_NOTE_CURRENT_DOCUMENT_UNAVAILABLE',
    'LITERATURE_NOTE_CURRENT_DOCUMENT_MISMATCH',
    'LITERATURE_NOTE_EVIDENCE_RECEIPT_INVALID',
    'LITERATURE_NOTE_BASIC_TEMPLATE_MISSING',
    'LITERATURE_NOTE_TEMPLATE_FIELDS_MISSING',
    'LITERATURE_NOTE_PROVIDER_SCENARIO_FAILED',
    'LITERATURE_NOTE_PRODUCTION_OPERATION_INVALID',
    'LITERATURE_NOTE_BOUNDARY_INVALID',
    'LITERATURE_NOTE_TWO_OPERATION_MISMATCH',
    'LITERATURE_NOTE_SECOND_RESPONSE_BINDING_FAILED',
    'LITERATURE_NOTE_SECOND_RESPONSE_SAVE_STALE',
    'LITERATURE_NOTE_SCREENSHOT_MISSING',
    'LITERATURE_NOTE_SCREENSHOT_INVALID',
    'LITERATURE_NOTE_CAPTURE_RECEIPT_ALREADY_EXISTS',
    'LITERATURE_NOTE_PRODUCTION_RECEIPT_CHANGED'
  ]);
  if (allowed.has(message)) return message;
  return 'LITERATURE_NOTE_REAL_PAPER_VERIFIER_FAILED';
}

export function privateRuntimeFailureDiagnostic(error) {
  const name = /^[A-Za-z]+Error$/u.test(String(error?.name || ''))
    ? String(error.name) : 'Error';
  const messageSha256 = crypto.createHash('sha256')
    .update(String(error?.message || error || '')).digest('hex');
  const frames = [];
  for (const line of String(error?.stack || '').split(/\r?\n/u).slice(1)) {
    const match = line.match(/((?:[A-Za-z]:[\\/]|file:\/\/\/)[^():\r\n]+?\.(?:mjs|js)):(\d+):(\d+)/u);
    if (!match) continue;
    const file = path.basename(match[1].replace(/^file:\/\/\//u, '').replace(/\\/gu, '/'));
    frames.push({ file, line: Number(match[2]), column: Number(match[3]) });
    if (frames.length >= 8) break;
  }
  return Object.freeze({ name, messageSha256, frames: Object.freeze(frames) });
}

const QA_ERROR_CODES = Object.freeze({
  input: 'INPUT_VALIDATION_FAILED',
  launch: 'BROWSER_LAUNCH_FAILED',
  connection_probe: 'CONNECTION_PROBE_FAILED',
  article_prepare: 'ARTICLE_PREPARATION_FAILED',
  panel_open: 'NOTE_PANEL_OPEN_FAILED',
  autofill: 'AUTOFILL_OPERATION_FAILED',
  screenshot_capture: 'SCREENSHOT_CAPTURE_FAILED',
  native_inspection: 'NATIVE_INSPECTION_FAILED',
  audit_existing: 'EXISTING_CAPTURE_AUDIT_FAILED',
  report: 'REPORT_FINALIZATION_FAILED'
});

export function safeQaDiagnostic(error, fallbackStage = 'input') {
  const requested = clean(error?.qaStage, 40);
  const fallback = Object.hasOwn(QA_ERROR_CODES, fallbackStage) ? fallbackStage : 'input';
  const qaStage = Object.hasOwn(QA_ERROR_CODES, requested) ? requested : fallback;
  return Object.freeze({ qaStage, errorCode: QA_ERROR_CODES[qaStage] });
}

async function atQaStage(qaStage, operation) {
  try { return await operation(); } catch (error) {
    if (!Object.hasOwn(QA_ERROR_CODES, clean(error?.qaStage, 40))) error.qaStage = qaStage;
    throw error;
  }
}

function writeJsonAtomically(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filename);
}

export function beginReport(outputDir) {
  const active = {
    filename: path.join(path.resolve(outputDir), 'qa-result.json'),
    runId: crypto.randomUUID(),
    generatedAt: new Date().toISOString()
  };
  writeJsonAtomically(active.filename, {
    schemaVersion: 1,
    runId: active.runId,
    generatedAt: active.generatedAt,
    status: 'RUNNING',
    papers: [],
    pass: false,
    security: { secretScanPassed: false, outputAllowlistPassed: false }
  });
  return Object.freeze(active);
}

export function finalExitCode(report = {}, securityAudit = {}) {
  return report.pass === true && securityAudit.ok === true ? 0 : 1;
}

function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally { fs.closeSync(handle); }
  return hash.digest('hex');
}

export function screenshotEvidenceFromFile(filename, kind) {
  const absolute = path.resolve(filename);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error('LITERATURE_NOTE_SCREENSHOT_MISSING');
  }
  const header = fs.readFileSync(absolute).subarray(0, 24);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (header.length < 24 || !header.subarray(0, 8).equals(pngSignature)) {
    throw new Error('LITERATURE_NOTE_SCREENSHOT_INVALID');
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (width < 1 || height < 1) throw new Error('LITERATURE_NOTE_SCREENSHOT_INVALID');
  return Object.freeze({
    kind: clean(kind, 80),
    filename: path.basename(absolute),
    exists: true,
    sha256: sha256File(absolute),
    width,
    height,
    browserName: 'msedge',
    absolutePath: absolute
  });
}

function jsonSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function captureProfileProof(value = {}) {
  return {
    profileId: clean(value.profileId, 80),
    providerId: clean(value.providerId, 80),
    model: clean(value.model, 300),
    requestedProfileId: value.requestedProfileId == null
      ? null : clean(value.requestedProfileId, 80),
    outputLanguage: clean(value.outputLanguage, 20),
    profileSignature: clean(value.profileSignature, 64).toLowerCase(),
    productionProfileSignature: clean(value.productionProfileSignature, 64).toLowerCase()
  };
}

function capturePublicRoute(value = {}) {
  return {
    taskType: clean(value.taskType, 40),
    requestedProfileId: value.requestedProfileId == null
      ? null : clean(value.requestedProfileId, 80),
    effectiveProfileId: clean(value.effectiveProfileId, 80),
    providerId: clean(value.providerId, 80),
    model: clean(value.model, 300),
    outputLanguage: clean(value.outputLanguage, 20),
    capabilityMode: clean(value.capabilityMode, 40),
    fallbackReason: value.fallbackReason == null ? null : clean(value.fallbackReason, 120)
  };
}

function captureOperationEvidence(value = {}) {
  return {
    operationId: clean(value.operationId, 100),
    cacheHit: value.cacheHit === true,
    values: structuredClone(value.values || {}),
    statuses: structuredClone(value.statuses || {}),
    sources: structuredClone(value.sources || {}),
    templateId: clean(value.templateId, 100),
    documentHash: clean(value.documentHash, 64).toLowerCase(),
    records: (Array.isArray(value.records) ? value.records : []).map(record => ({
      paragraphId: clean(record?.paragraphId, 200),
      sourceIdentity: clean(record?.sourceIdentity, 300),
      textHash: clean(record?.textHash, 64).toLowerCase()
    })),
    operationReceipt: structuredClone(value.operationReceipt || {}),
    route: capturePublicRoute(value.route)
  };
}

function captureScenarioEvidence(value = {}) {
  return {
    templateId: clean(value.templateId, 100),
    expectedMismatch: value.expectedMismatch === true,
    documentHash: clean(value.documentHash, 64).toLowerCase(),
    initialValues: structuredClone(value.initialValues || {}),
    pendingEdits: structuredClone(value.pendingEdits || {}),
    finalValues: structuredClone(value.finalValues || {}),
    statuses: structuredClone(value.statuses || {}),
    counts: countShape(value.counts),
    saved: value.saved === true,
    appliedOperationId: clean(value.appliedOperationId, 100),
    operations: {
      first: captureOperationEvidence(value.operations?.first),
      second: captureOperationEvidence(value.operations?.second)
    }
  };
}

function capturePaperEvidence(value = {}) {
  return {
    key: clean(value.key, 100),
    title: clean(value.title, 500),
    identifier: clean(value.identifier, 200),
    sha256: clean(value.sha256, 64).toLowerCase(),
    documentHash: clean(value.documentHash, 64).toLowerCase(),
    diagnostics: {
      articleErrors: (Array.isArray(value.diagnostics?.articleErrors)
        ? value.diagnostics.articleErrors : []).map(error => clean(error, 300)),
      panelErrors: (Array.isArray(value.diagnostics?.panelErrors)
        ? value.diagnostics.panelErrors : []).map(error => clean(error, 300))
    },
    scenarios: (Array.isArray(value.scenarios) ? value.scenarios : [])
      .map(captureScenarioEvidence)
  };
}

function captureReceiptPayload(value = {}) {
  return {
    schemaVersion: 2,
    manifestSha256: clean(value.manifestSha256, 64).toLowerCase(),
    captures: (Array.isArray(value.captures) ? value.captures : []).map(capture => ({
      kind: clean(capture?.kind, 80),
      filename: path.basename(clean(capture?.filename, 200)),
      sha256: clean(capture?.sha256, 64).toLowerCase(),
      width: Number(capture?.width),
      height: Number(capture?.height),
      browserName: clean(capture?.browserName, 40)
    })),
    profileRows: (Array.isArray(value.profileRows) ? value.profileRows : []).map(row => ({
      profileRole: clean(row?.profileRole, 40),
      profileSignature: clean(row?.profileSignature, 64).toLowerCase()
    })),
    profileProof: captureProfileProof(value.profileProof),
    papers: (Array.isArray(value.papers) ? value.papers : []).map(capturePaperEvidence)
  };
}

function captureReceiptEvidenceShapeValid(receipt = {}) {
  const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const operationValid = operation => hasExactKeys(operation, [
    'operationId', 'cacheHit', 'values', 'statuses', 'sources', 'templateId',
    'documentHash', 'records', 'operationReceipt', 'route'
  ]) && plain(operation.values) && plain(operation.statuses) && plain(operation.sources) &&
    Array.isArray(operation.records) && operation.records.every(record => hasExactKeys(record, [
      'paragraphId', 'sourceIdentity', 'textHash'
    ])) && hasExactKeys(operation.operationReceipt, [
      'schemaVersion', 'operationId', 'cacheHit', 'providerAttempts', 'cacheIdentity'
    ]) && hasExactKeys(operation.operationReceipt.cacheIdentity, [
      'cacheKey', 'documentHash', 'evidenceSignature', 'templateSignature',
      'profileSignature', 'outputLanguage'
    ]) && sameJson(operation.route, capturePublicRoute(operation.route));
  const scenarioValid = scenario => hasExactKeys(scenario, [
    'templateId', 'expectedMismatch', 'documentHash', 'initialValues', 'pendingEdits',
    'finalValues', 'statuses', 'counts', 'saved', 'appliedOperationId', 'operations'
  ]) && plain(scenario.initialValues) && plain(scenario.pendingEdits) &&
    plain(scenario.finalValues) && plain(scenario.statuses) &&
    hasExactKeys(scenario.counts, ['filled', 'missing', 'preserved', 'invalid']) &&
    hasExactKeys(scenario.operations, ['first', 'second']) &&
    operationValid(scenario.operations.first) && operationValid(scenario.operations.second);
  const paperValid = paper => hasExactKeys(paper, [
    'key', 'title', 'identifier', 'sha256', 'documentHash', 'diagnostics', 'scenarios'
  ]) && hasExactKeys(paper.diagnostics, ['articleErrors', 'panelErrors']) &&
    Array.isArray(paper.diagnostics.articleErrors) && Array.isArray(paper.diagnostics.panelErrors) &&
    Array.isArray(paper.scenarios) && paper.scenarios.every(scenarioValid);
  return Array.isArray(receipt.profileRows) && receipt.profileRows.every(row => hasExactKeys(row, [
    'profileRole', 'profileSignature'
  ])) && hasExactKeys(receipt.profileProof, [
    'profileId', 'providerId', 'model', 'requestedProfileId', 'outputLanguage',
    'profileSignature', 'productionProfileSignature'
  ]) && Array.isArray(receipt.papers) && receipt.papers.every(paperValid);
}

export function buildCaptureReceipt({ manifest = {}, evidence = {} } = {}) {
  const payload = captureReceiptPayload({
    manifestSha256: jsonSha256(manifest),
    captures: evidence.captures,
    profileRows: evidence.profileRows,
    profileProof: evidence.profileProof,
    papers: evidence.papers
  });
  return Object.freeze({
    ...payload,
    captureSha256: jsonSha256(payload)
  });
}

export function writeCaptureReceiptOnce(outputDir, receipt) {
  const filename = path.join(path.resolve(outputDir), 'private-capture-receipt.json');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  try {
    fs.writeFileSync(filename, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx'
    });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('LITERATURE_NOTE_CAPTURE_RECEIPT_ALREADY_EXISTS');
    throw error;
  }
  return filename;
}

export function auditExistingCapture({ outputDir, manifest = {}, receipt = {}, inspection = {} } = {}) {
  const payload = captureReceiptPayload(receipt);
  const exactReceiptShape = hasExactKeys(receipt, [
    'schemaVersion', 'manifestSha256', 'captures', 'profileRows', 'profileProof',
    'papers', 'captureSha256'
  ]) && captureReceiptEvidenceShapeValid(receipt) &&
    (Array.isArray(receipt.captures) ? receipt.captures : []).every(capture =>
    hasExactKeys(capture, [
      'kind', 'filename', 'sha256', 'width', 'height', 'browserName'
    ]));
  const receiptBound = exactReceiptShape && receipt?.schemaVersion === 2 &&
    SHA256.test(String(receipt?.captureSha256 || '')) &&
    receipt.captureSha256 === jsonSha256(payload) &&
    payload.manifestSha256 === jsonSha256(manifest);
  const captures = payload.captures.map(capture => ({
    ...capture,
    absolutePath: path.join(path.resolve(outputDir), 'screenshots', capture.filename)
  }));
  const captureNamesSafe = captures.length === requiredScreenshotKinds.length &&
    requiredScreenshotKinds.every(kind => captures.filter(capture =>
      capture.kind === kind && capture.filename === `${kind}.png`).length === 1);
  const inspectionBound = SHA256.test(String(inspection?.captureSha256 || '')) &&
    inspection.captureSha256 === receipt.captureSha256;
  const nativeAudit = auditNativeInspection({
    headedEdge: receiptBound && captureNamesSafe && inspectionBound,
    captures,
    reviews: inspection?.screenshots || {}
  });
  const profileAudit = auditProfileCoverage(payload.profileRows);
  const profileProofValid = SHA256.test(payload.profileProof.profileSignature) &&
    PRODUCTION_SIGNATURE.test(payload.profileProof.productionProfileSignature) &&
    Boolean(payload.profileProof.profileId && payload.profileProof.providerId &&
      payload.profileProof.model && payload.profileProof.outputLanguage);
  const papers = payload.papers.map(paper => {
    const manifestPaper = (Array.isArray(manifest.papers) ? manifest.papers : [])
      .find(candidate => candidate?.key === paper.key);
    const manifestBound = Boolean(manifestPaper) &&
      paper.title === clean(manifestPaper.title, 500) &&
      paper.identifier === clean(manifestPaper.identifier, 200) &&
      paper.sha256 === clean(manifestPaper.sha256, 64).toLowerCase() &&
      SHA256.test(paper.documentHash);
    const scenarios = paper.scenarios.map(scenario => {
      const first = scenario.operations.first;
      const second = scenario.operations.second;
      const firstAudit = auditProductionAutofillResponse({ success: true, data: first }, {
        operationId: first.operationId,
        routeProof: payload.profileProof,
        expectedCacheHit: false
      });
      const secondAudit = auditProductionAutofillResponse({ success: true, data: second }, {
        operationId: second.operationId,
        routeProof: payload.profileProof,
        expectedCacheHit: true
      });
      const sourceAudit = auditSourceCitations({
        sources: second.sources,
        records: second.records,
        documentHash: scenario.documentHash
      });
      const fieldAudit = auditAutofillScenario({
        ...scenario,
        sources: sourceAudit.sources,
        currentDocumentSources: sourceAudit.currentDocumentSources,
        cacheHit: second.cacheHit,
        requestIdentity: second.operationReceipt?.cacheIdentity
      });
      const replay = operation => ({
        ...comparableProductionResponse(operation),
        finalValues: operation.values,
        statuses: operation.statuses,
        sources: operation.sources,
        counts: {
          filled: Object.values(operation.statuses || {}).filter(value => value === 'supported').length,
          missing: Object.values(operation.statuses || {}).filter(value => value === 'missing').length,
          preserved: 0,
          invalid: 0
        },
        cacheHit: operation.cacheHit,
        requestIdentity: operation.operationReceipt?.cacheIdentity
      });
      const cacheAudit = auditCacheReplay({
        first: replay(first), second: replay(second),
        providerCalls: {
          first: first.operationReceipt?.providerAttempts,
          second: second.operationReceipt?.providerAttempts
        }
      });
      const operationBound = scenario.saved === true &&
        scenario.documentHash === paper.documentHash &&
        scenario.appliedOperationId === second.operationId &&
        first.operationId !== second.operationId &&
        first.documentHash === scenario.documentHash && second.documentHash === scenario.documentHash &&
        first.operationReceipt?.cacheIdentity?.documentHash === scenario.documentHash &&
        sameJson(first.records, second.records) &&
        sameJson(first.operationReceipt?.cacheIdentity, second.operationReceipt?.cacheIdentity);
      const mismatchSatisfied = scenario.expectedMismatch !== true ||
        fieldAudit.actualCounts.missing > 0;
      return {
        ...scenario,
        pass: firstAudit.ok && secondAudit.ok && sourceAudit.ok && fieldAudit.ok &&
          cacheAudit.ok && operationBound && mismatchSatisfied
      };
    });
    const matrixAudit = auditScenarioMatrix(scenarios);
    return {
      ...paper,
      scenarios,
      pass: manifestBound && paper.diagnostics.articleErrors.length === 0 &&
        paper.diagnostics.panelErrors.length === 0 && scenarios.every(scenario => scenario.pass) &&
        matrixAudit.ok
    };
  });
  const paperMatrixValid = papers.length === requiredPapers.length &&
    requiredPapers.every(required => papers.find(paper => paper.key === required.key)?.pass === true);
  return Object.freeze({
    captures,
    captureSha256: receipt.captureSha256,
    profileAudit,
    nativeAudit,
    papers,
    pass: receiptBound && captureNamesSafe && inspectionBound && nativeAudit.ok &&
      paperMatrixValid && profileAudit.ok && profileProofValid
  });
}

async function extensionWorker(context) {
  return context.serviceWorkers()[0] ||
    context.waitForEvent('serviceworker', { timeout: 20000 });
}

export function seedTrustedProfile({ sourceDir, targetDir } = {}) {
  const source = sourceDir ? path.resolve(sourceDir) : '';
  const target = targetDir ? path.resolve(targetDir) : '';
  if (!source || !target || source === target || !fs.existsSync(source) ||
      !fs.statSync(source).isDirectory() || fs.existsSync(target)) {
    throw new Error('PENDING_EXTERNAL_INPUT: trusted profile copy is unavailable');
  }
  const excluded = new Set([
    'SingletonCookie', 'SingletonLock', 'SingletonSocket', 'lockfile', 'LOCK'
  ]);
  fs.cpSync(source, target, {
    recursive: true,
    errorOnExist: true,
    filter: candidate => !excluded.has(path.basename(candidate))
  });
  return { copied: true };
}

export async function launchHeadedExtension({
  chromiumApi, profileDir, extensionPath
} = {}) {
  const manifest = path.join(extensionPath || '', 'manifest.json');
  if (!fs.existsSync(manifest)) throw new Error('PENDING_EXTERNAL_INPUT: unpacked extension is missing');
  const context = await chromiumApi.launchPersistentContext(profileDir, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1280, height: 1000 },
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  try {
    const worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    if (!String(extensionPage.url?.() || '')
      .startsWith(`chrome-extension://${extensionId}/`)) {
      throw new Error('PENDING_EXTERNAL_INPUT: extension runtime page origin mismatch');
    }
    return { context, worker, extensionPage, extensionId };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

function titleMatches(expected, actual) {
  const tokens = value => clean(value, 1000).toLowerCase().match(/[a-z0-9]+/gu)
    ?.filter(token => token.length > 2) || [];
  const expectedTokens = [...new Set(tokens(expected))];
  const actualTokens = new Set(tokens(actual));
  return expectedTokens.length >= 4 &&
    expectedTokens.filter(token => actualTokens.has(token)).length / expectedTokens.length >= 0.75;
}

export function titleEvidenceMatches(expected, evidence = {}) {
  const headings = Array.isArray(evidence.headings) ? evidence.headings : [];
  const values = [evidence.documentTitle, evidence.citationTitle, evidence.openGraphTitle,
    ...(headings.length === 1 ? headings : [])];
  return values.some(value => titleMatches(expected, value));
}

function normalizeArticleUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

export function articleDocumentProofMatches(paper = {}, prepared = {}) {
  return prepared?.success === true &&
    SHA256.test(String(prepared.documentHash || '')) &&
    normalizeArticleUrl(prepared.canonicalUrl) === normalizeArticleUrl(paper.articleUrl);
}

async function waitForArticleTitleEvidence(page, expected, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const evidence = await page.evaluate(() => ({
      documentTitle: document.title,
      citationTitle: document.querySelector('meta[name="citation_title"]')?.content || '',
      openGraphTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      headings: [...document.querySelectorAll('h1')]
        .map(node => node.textContent?.trim() || '').filter(Boolean)
    }));
    if (titleEvidenceMatches(expected, evidence)) return evidence;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return null;
}

export async function sendArticleMessageWithRecovery(extensionPage, tabId, message) {
  return extensionPage.evaluate(async input => {
    const sendWithRecovery = globalThis.SciLLM?.sendTabMessageWithRecovery;
    if (typeof sendWithRecovery !== 'function') {
      throw new Error('LITERATURE_NOTE_CONTENT_RECOVERY_UNAVAILABLE');
    }
    return sendWithRecovery(chrome, input.tabId, input.message);
  }, { tabId, message });
}

async function prepareRealArticle(context, extensionPage, paper) {
  const page = await context.newPage();
  await page.goto(paper.articleUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('load', { timeout: 90000 }).catch(() => undefined);
  if (!await waitForArticleTitleEvidence(page, paper.title)) {
    throw new Error(`PENDING_EXTERNAL_INPUT: title mismatch for ${paper.key}`);
  }
  const tabs = await extensionPage.evaluate(() => chrome.tabs.query({}));
  const normalizeTabUrl = value => {
    try {
      const url = new URL(String(value || ''));
      url.hash = '';
      return url.href;
    } catch { return String(value || '').split('#')[0]; }
  };
  const articleUrl = normalizeTabUrl(page.url());
  const tab = (Array.isArray(tabs) ? tabs : []).find(item =>
    normalizeTabUrl(item?.url || item?.pendingUrl) === articleUrl) || null;
  if (!tab?.id) throw new Error('LITERATURE_NOTE_ARTICLE_TAB_MISSING');
  let prepared = null;
  for (let attempt = 0; attempt < 80 && !prepared?.success; attempt += 1) {
    prepared = await sendArticleMessageWithRecovery(extensionPage, tab.id, {
      action: 'prepareManualAnnotations'
    }).catch(() => null);
    if (!prepared?.success) await page.waitForTimeout(250);
  }
  if (!prepared?.success || !SHA256.test(String(prepared.documentHash || ''))) {
    throw new Error('LITERATURE_NOTE_CURRENT_DOCUMENT_UNAVAILABLE');
  }
  if (!articleDocumentProofMatches(paper, prepared)) {
    throw new Error('LITERATURE_NOTE_CURRENT_DOCUMENT_MISMATCH');
  }
  return { page, tab, prepared };
}

async function configuredTemplates(extensionPage) {
  return extensionPage.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' });
    if (!response?.success) return [];
    const state = response.data;
    const configured = state?.settings?.literatureNoteTemplates;
    return Array.isArray(configured) && configured.length
      ? configured : (state?.literatureNoteTemplateDefaults || []);
  });
}

export async function probeConfiguredLlm(context, extensionPage, extensionId) {
  const runtimeUrl = String(extensionPage?.url?.() || '');
  if (!runtimeUrl.startsWith(`chrome-extension://${clean(extensionId, 80)}/`)) {
    throw new Error('PENDING_EXTERNAL_INPUT: extension runtime page origin mismatch');
  }
  const settingsResponse = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' }));
  const routeProof = parseRuntimeSettingsProof(settingsResponse);
  if (!routeProof || !auditProfileCoverage(routeProof.profileRows).ok) {
    throw new Error('PENDING_EXTERNAL_INPUT: configured LLM profile is not ready');
  }
  const requestedProbeIds = ['structured_schema'];
  const probe = await extensionPage.evaluate(profileId => chrome.runtime.sendMessage({
    type: 'LLM_TEST_PROFILE', profileId, probeIds: ['structured_schema']
  }), routeProof.profileId);
  const probeAudit = auditConnectionProbeResponse(probe, routeProof, requestedProbeIds);
  if (!probeAudit.ok) {
    throw new Error('PENDING_EXTERNAL_INPUT: configured LLM connection probe failed');
  }
  return { ...routeProof, probeReceipt: probeAudit.receipt };
}

export function auditConnectionProbeResponse(response = {}, routeProof = {}, requestedIds = []) {
  const data = response?.success === true && response.data && typeof response.data === 'object'
    ? response.data : null;
  const expectedIds = Array.isArray(requestedIds) ? requestedIds.map(id => clean(id, 64)) : [];
  const probes = Array.isArray(data?.probes) ? data.probes : [];
  const actualIds = probes.map(probe => clean(probe?.id, 64));
  const uniqueIds = new Set(actualIds);
  const diagnostics = data?.diagnostics;
  const ok = Boolean(data) && data.connected === true &&
    clean(data.profileId, 80) === clean(routeProof.profileId, 80) &&
    clean(data.providerId, 80) === clean(routeProof.providerId, 80) &&
    clean(data.model, 300) === clean(routeProof.model, 300) &&
    expectedIds.length > 0 && probes.length === expectedIds.length &&
    uniqueIds.size === expectedIds.length && expectedIds.every(id => uniqueIds.has(id)) &&
    probes.every(probe => probe?.status === 'passed') &&
    Array.isArray(data.warnings) && data.warnings.length === 0 &&
    diagnostics && Array.isArray(diagnostics.failedProbeIds) &&
    diagnostics.failedProbeIds.length === 0 && Array.isArray(diagnostics.invalidProbeIds) &&
    diagnostics.invalidProbeIds.length === 0 && SHA256.test(routeProof.profileSignature || '');
  return Object.freeze({
    ok,
    receipt: ok ? Object.freeze({
      connected: true,
      profileId: clean(data.profileId, 80),
      providerId: clean(data.providerId, 80),
      model: clean(data.model, 300),
      probeIds: Object.freeze([...expectedIds]),
      profileSignature: clean(routeProof.profileSignature, 64).toLowerCase()
    }) : null
  });
}

export function auditProductionAutofillResponse(response = {}, {
  operationId = '', routeProof = {}, expectedCacheHit, evidenceReceipt = null
} = {}) {
  const data = response?.success === true && response.data && typeof response.data === 'object'
    ? response.data : null;
  const route = data?.route;
  const receipt = data?.operationReceipt;
  const cache = buildProductionCacheReceipt(receipt?.cacheIdentity);
  const expectedOperationId = clean(operationId, 100);
  const cacheHit = data?.cacheHit;
  const providerAttempts = Number(receipt?.providerAttempts);
  const receiptShapeValid = hasExactKeys(receipt, [
    'schemaVersion', 'operationId', 'cacheHit', 'providerAttempts', 'cacheIdentity'
  ]) && hasExactKeys(receipt?.cacheIdentity, [
    'cacheKey', 'documentHash', 'evidenceSignature', 'templateSignature',
    'profileSignature', 'outputLanguage'
  ]);
  const expectedCacheKey = evidenceReceipt ? `literature-note:${productionStableHash({
    version: 3,
    documentHash: evidenceReceipt.documentHash,
    evidence: evidenceReceipt.evidenceSignature,
    template: evidenceReceipt.templateSignature,
    profile: routeProof.productionProfileSignature,
    outputLanguage: routeProof.outputLanguage
  })}` : cache.identity.cacheKey;
  const ok = Boolean(data && route) && Boolean(expectedOperationId) &&
    clean(data.operationId, 100) === expectedOperationId && typeof cacheHit === 'boolean' &&
    cacheHit === expectedCacheHit && receiptShapeValid && receipt?.schemaVersion === 1 &&
    receipt.operationId === expectedOperationId && receipt.cacheHit === expectedCacheHit &&
    Number.isSafeInteger(providerAttempts) && providerAttempts >= 0 &&
    providerAttempts === (expectedCacheHit ? 0 : providerAttempts) &&
    (expectedCacheHit || providerAttempts > 0) && cache.ok &&
    cache.identity.profileSignature === clean(routeProof.productionProfileSignature, 64).toLowerCase() &&
    cache.identity.cacheKey === expectedCacheKey &&
    (!evidenceReceipt || (
      cache.identity.documentHash === clean(evidenceReceipt.documentHash, 64).toLowerCase() &&
      cache.identity.evidenceSignature === clean(evidenceReceipt.evidenceSignature, 64).toLowerCase() &&
      cache.identity.templateSignature === clean(evidenceReceipt.templateSignature, 64).toLowerCase() &&
      cache.identity.outputLanguage === clean(routeProof.outputLanguage, 20)
    )) &&
    route.taskType === 'literature_note_autofill' &&
    clean(route.requestedProfileId, 80) === clean(routeProof.requestedProfileId, 80) &&
    clean(route.effectiveProfileId, 80) === clean(routeProof.profileId, 80) &&
    clean(route.providerId, 80) === clean(routeProof.providerId, 80) &&
    clean(route.model, 300) === clean(routeProof.model, 300) &&
    clean(route.outputLanguage, 20) === clean(routeProof.outputLanguage, 20) &&
    route.capabilityMode === 'text' && route.fallbackReason === null;
  return Object.freeze({
    ok,
    receipt: ok ? receipt : null
  });
}

async function invokeProductionAutofill(
  extensionPage, tabId, template, operationId, routeProof, expectedCacheHit
) {
  const contentResponse = await sendArticleMessageWithRecovery(extensionPage, tabId, {
    action: 'autofillLiteratureNoteWithLLM',
    template,
    operationId,
    forceRefresh: false
  });
  if (!contentResponse?.success) {
    throw new Error(`LITERATURE_NOTE_PROVIDER_SCENARIO_FAILED:${
      providerScenarioFailureCode(contentResponse)
    }`);
  }
  const production = contentResponse.result || {};
  const evidenceReceipt = production.evidenceReceipt;
  if (!evidenceReceipt?.documentHash || !Array.isArray(evidenceReceipt.records)) {
    throw new Error('LITERATURE_NOTE_EVIDENCE_RECEIPT_INVALID');
  }
  const result = {
    success: true,
    data: {
      values: production.values || {},
      statuses: production.fieldStatus || {},
      sources: production.sources || {},
      summary: production.summary || {},
      templateId: production.templateId,
      documentHash: production.documentHash,
      cacheHit: production.cacheHit === true,
      operationId: production.operationId,
      operationReceipt: production.operationReceipt,
      route: production.route,
      records: evidenceReceipt.records
    }
  };
  const operationAudit = auditProductionAutofillResponse(result, {
    operationId, routeProof, expectedCacheHit, evidenceReceipt
  });
  if (!operationAudit.ok) throw new Error('LITERATURE_NOTE_PRODUCTION_OPERATION_INVALID');
  return result;
}

export function providerScenarioFailureCode(response) {
  if (!response || typeof response !== 'object') return 'NO_RESPONSE';
  const responseCode = clean(response.code, 80);
  if (/^[A-Z][A-Z0-9_-]{2,80}$/u.test(responseCode)) return responseCode;
  const error = response.error;
  if (typeof error === 'string') return 'ERROR_STRING';
  if (!error || typeof error !== 'object' || Array.isArray(error)) return 'INVALID_ENVELOPE';
  const code = clean(error.code, 80);
  return /^[A-Z][A-Z0-9_-]{2,80}$/u.test(code) ? code : 'ERROR_WITHOUT_CODE';
}

export async function openNotePanel(context, extensionPage, extensionId, tab) {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 700, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await extensionPage.evaluate(async tabId => {
    const activated = await chrome.tabs.update(tabId, { active: true });
    if (Number.isInteger(activated?.windowId)) {
      await chrome.windows.update(activated.windowId, { focused: true });
    }
  }, tab.id);
  await panel.locator('#openLiteratureNote').waitFor({ state: 'visible', timeout: 30000 });
  const button = panel.locator('#openLiteratureNote');
  const drawer = panel.locator('#literatureNoteDrawer');
  let opened = false;
  for (let attempt = 0; attempt < 60 && !opened; attempt += 1) {
    await button.click();
    try {
      await drawer.waitFor({ state: 'visible', timeout: 500 });
      opened = true;
    } catch { opened = false; }
  }
  if (!opened) throw new Error('LITERATURE_NOTE_DRAWER_OPEN_TIMEOUT');
  return panel;
}

async function preparePanelApplication(panel, template, { preserveEdit = false } = {}) {
  const select = panel.locator('#literatureNoteTemplateSelect');
  await select.selectOption(template.id);
  await panel.waitForTimeout(350);
  const fields = panel.locator('[data-literature-note-field]');
  const fieldCount = await fields.count();
  if (fieldCount < (preserveEdit ? 2 : 1)) throw new Error('LITERATURE_NOTE_TEMPLATE_FIELDS_MISSING');
  if (preserveEdit) {
    const existing = fields.nth(0);
    await existing.fill('QA existing reader note');
    await existing.dispatchEvent('input');
  }
  return panel.evaluate(templateId => {
    const values = literatureNoteDocumentState.valuesByTemplate?.[templateId] || {};
    globalThis.__literatureNoteQaInitialValues = structuredClone(values);
    globalThis.__literatureNoteQaInitialFieldRevisions = new Map(literatureNoteFieldEditVersions);
    return { initialValues: structuredClone(values) };
  }, template.id);
}

async function makePendingPanelEdit(panel, preserveEdit) {
  if (!preserveEdit) return {};
  const fields = panel.locator('[data-literature-note-field]');
  const pending = fields.nth(1);
  const fieldId = await pending.getAttribute('data-literature-note-field');
  const pendingEdits = { [fieldId]: 'QA reader edit while provider response is pending' };
  await pending.fill(pendingEdits[fieldId]);
  await pending.dispatchEvent('input');
  return pendingEdits;
}

async function applySecondResponseToPanel(panel, template, response, operationId) {
  return panel.evaluate(async ({ selectedTemplate, secondResponse, appliedOperationId }) => {
    if (secondResponse?.operationId !== appliedOperationId || !secondResponse?.cacheHit) {
      throw new Error('LITERATURE_NOTE_SECOND_RESPONSE_BINDING_FAILED');
    }
    const result = {
      values: secondResponse.values || {},
      fieldStatus: secondResponse.statuses || {},
      sources: secondResponse.sources || {},
      summary: secondResponse.summary || {},
      templateId: secondResponse.templateId,
      documentHash: secondResponse.documentHash,
      cacheHit: true
    };
    const applied = applyLiteratureNoteAutofillResult({
      template: selectedTemplate,
      state: literatureNoteDocumentState,
      initialValues: globalThis.__literatureNoteQaInitialValues,
      initialFieldRevisions: globalThis.__literatureNoteQaInitialFieldRevisions,
      currentFieldRevisions: literatureNoteFieldEditVersions,
      result
    });
    applied.changedFields.forEach(fieldId => {
      markLiteratureNoteFieldDirty(`${selectedTemplate.id}\u0000${fieldId}`);
    });
    updateLiteratureNoteRenderedFields({
      fields: document.getElementById('literatureNoteFields'),
      templateId: selectedTemplate.id,
      state: literatureNoteDocumentState,
      changedFields: applied.changedFields,
      translate: t
    });
    const persisted = await persistLiteratureNoteDocumentState();
    if (persisted?.stale) throw new Error('LITERATURE_NOTE_SECOND_RESPONSE_SAVE_STALE');
    const summary = createLiteratureNoteAutofillSummary(applied.counts, true);
    const status = document.getElementById('literatureNoteStatus');
    if (status) status.textContent = t(summary.message);
    globalThis.__literatureNoteQaAppliedOperationId = appliedOperationId;
    const values = literatureNoteDocumentState.valuesByTemplate?.[selectedTemplate.id] || {};
    const statuses = literatureNoteDocumentState.fieldStatusByTemplate?.[selectedTemplate.id] || {};
    return {
      finalValues: structuredClone(values),
      statuses: structuredClone(statuses),
      counts: applied.counts,
      saved: true,
      appliedOperationId: globalThis.__literatureNoteQaAppliedOperationId
    };
  }, { selectedTemplate: template, secondResponse: response.data, appliedOperationId: operationId });
}

async function captureScreenshot(panel, outputDir, kind, { fullPage = false } = {}) {
  const screenshotDir = path.join(outputDir, 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const filename = path.join(screenshotDir, `${kind}.png`);
  if (fullPage) await panel.screenshot({ path: filename, fullPage: true });
  else await panel.locator('#literatureNoteDrawer').screenshot({ path: filename });
  return screenshotEvidenceFromFile(filename, kind);
}

async function runTemplateScenario({
  context, extensionPage, tab, panel, template, documentHash,
  paperKey, routeProof, expectedMismatch = false, preserveEdit = false
}) {
  const preparedUi = await preparePanelApplication(panel, template, { preserveEdit });
  let pendingEdits = {};
  let appliedUi = null;
  let operationNumber = 0;
  const boundary = await runTwoOperationBoundary({
    invoke: async ({ expectedCacheHit }) => {
      operationNumber += 1;
      const operationId = `literature-note-qa-${crypto.randomUUID()}`;
      return invokeProductionAutofill(
        extensionPage, tab.id, template, operationId, routeProof, expectedCacheHit
      );
    },
    onSecondStarted: async () => {
      pendingEdits = await makePendingPanelEdit(panel, preserveEdit);
    },
    applySecond: async response => {
      appliedUi = await applySecondResponseToPanel(
        panel, template, response, response.data.operationId
      );
    }
  });
  const firstResult = boundary.first.data;
  const secondResult = boundary.second.data;
  if (!sameJson(firstResult.operationReceipt.cacheIdentity,
    secondResult.operationReceipt.cacheIdentity) ||
      !sameJson(firstResult.records, secondResult.records)) {
    throw new Error('LITERATURE_NOTE_PRODUCTION_RECEIPT_CHANGED');
  }
  const cacheAudit = auditCacheReplay({
    first: {
      ...comparableProductionResponse(firstResult),
      finalValues: firstResult.values,
      statuses: firstResult.statuses,
      sources: firstResult.sources,
      counts: {
        filled: Object.values(firstResult.statuses || {}).filter(value => value === 'supported').length,
        missing: Object.values(firstResult.statuses || {}).filter(value => value === 'missing').length,
        preserved: 0, invalid: 0
      },
      cacheHit: firstResult.cacheHit,
      requestIdentity: firstResult.operationReceipt.cacheIdentity
    },
    second: {
      ...comparableProductionResponse(secondResult),
      finalValues: secondResult.values,
      statuses: secondResult.statuses,
      sources: secondResult.sources,
      counts: {
        filled: Object.values(secondResult.statuses || {}).filter(value => value === 'supported').length,
        missing: Object.values(secondResult.statuses || {}).filter(value => value === 'missing').length,
        preserved: 0, invalid: 0
      },
      cacheHit: secondResult.cacheHit,
      requestIdentity: secondResult.operationReceipt.cacheIdentity
    },
    providerCalls: boundary.providerCalls
  });
  if (String(firstResult.documentHash || '') !== documentHash ||
      String(secondResult.documentHash || '') !== documentHash) {
    throw new Error('LITERATURE_NOTE_CURRENT_DOCUMENT_MISMATCH');
  }
  const sourceAudit = auditSourceCitations({
    sources: secondResult.sources,
    records: secondResult.records,
    documentHash
  });
  const scenario = {
    templateId: template.id, expectedMismatch, documentHash,
    initialValues: preparedUi.initialValues, pendingEdits,
    finalValues: appliedUi.finalValues, statuses: appliedUi.statuses,
    sources: sourceAudit.sources,
    currentDocumentSources: sourceAudit.currentDocumentSources,
    counts: appliedUi.counts,
    cacheHit: secondResult.cacheHit === true,
    requestIdentity: secondResult.operationReceipt.cacheIdentity
  };
  const fieldAudit = auditAutofillScenario(scenario);
  return {
    ...scenario,
    providerCalls: boundary.providerCalls,
    operationId: boundary.appliedOperationId,
    saved: appliedUi.saved === true,
    appliedOperationId: clean(appliedUi.appliedOperationId, 100),
    operations: {
      first: captureOperationEvidence(firstResult),
      second: captureOperationEvidence(secondResult)
    },
    pass: fieldAudit.ok && sourceAudit.ok && cacheAudit.ok && appliedUi.saved === true &&
      appliedUi.appliedOperationId === boundary.appliedOperationId,
    fieldAudit,
    sourceAudit,
    cacheAudit
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index];
    else if (argv[index] === '--extension') options.extension = argv[++index];
    else if (argv[index] === '--trusted-profile') options.trustedProfile = argv[++index];
    else if (argv[index] === '--inspection') options.inspection = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else if (argv[index] === '--audit-existing') options.auditExisting = true;
  }
  return options;
}

function pendingReport(error, diagnostic = safeQaDiagnostic(error)) {
  const safe = safeRuntimeFailure(error);
  return {
    schemaVersion: 1,
    status: safe.startsWith('PENDING_EXTERNAL_INPUT:')
      ? 'PENDING_EXTERNAL_INPUT' : 'FAILED',
    papers: [],
    pass: false,
    error: safe,
    qaStage: diagnostic.qaStage,
    errorCode: diagnostic.errorCode,
    security: { secretScanPassed: true, outputAllowlistPassed: true }
  };
}

async function runRealPaperGate({
  context, extensionPage, extensionId, papers, outputDir, inspection
}) {
  const routeProof = await atQaStage('connection_probe', () =>
    probeConfiguredLlm(context, extensionPage, extensionId));
  const profileAudit = auditProfileCoverage(routeProof.profileRows);
  const templates = await configuredTemplates(extensionPage);
  const byId = new Map(templates.map(template => [template.id, template]));
  const basic = byId.get('basic_research');
  if (!basic) throw new Error('LITERATURE_NOTE_BASIC_TEMPLATE_MISSING');
  const captures = [];
  const results = [];
  for (let paperIndex = 0; paperIndex < papers.length; paperIndex += 1) {
    const paper = papers[paperIndex];
    const mismatch = byId.get(paper.mismatchedTemplateId);
    if (!mismatch) {
      throw new Error(`PENDING_EXTERNAL_INPUT: mismatched template missing for ${paper.key}`);
    }
    const article = await atQaStage('article_prepare', () =>
      prepareRealArticle(context, extensionPage, paper));
    let panel;
    const diagnostics = { articleErrors: [], panelErrors: [] };
    article.page.on('pageerror', error => diagnostics.articleErrors.push(clean(error?.message, 300)));
    try {
      panel = await atQaStage('panel_open', () =>
        openNotePanel(context, extensionPage, extensionId, article.tab));
      panel.on('pageerror', error => diagnostics.panelErrors.push(clean(error?.message, 300)));
      const basicScenario = await atQaStage('autofill', () => runTemplateScenario({
        context, extensionPage, tab: article.tab, panel, template: basic,
        documentHash: article.prepared.documentHash,
        paperKey: paper.key, routeProof,
        preserveEdit: true, expectedMismatch: false
      }));
      if (paperIndex === 0) {
        captures.push(await atQaStage('screenshot_capture', () => captureScreenshot(
          panel, outputDir, 'preserved-reader-edit'
        )));
        captures.push(await atQaStage('screenshot_capture', () => captureScreenshot(
          panel, outputDir, 'completion-summary', { fullPage: true }
        )));
      }
      const mismatchScenario = await atQaStage('autofill', () => runTemplateScenario({
        context, extensionPage, tab: article.tab, panel, template: mismatch,
        documentHash: article.prepared.documentHash,
        paperKey: paper.key, routeProof,
        preserveEdit: false, expectedMismatch: true
      }));
      if (paperIndex === 0) {
        captures.push(await atQaStage('screenshot_capture', () => captureScreenshot(
          panel, outputDir, 'mixed-supported-missing'
        )));
      }
      const scenarios = [basicScenario, mismatchScenario];
      const matrixAudit = auditScenarioMatrix(scenarios);
      results.push({
        key: paper.key, title: paper.title, identifier: paper.identifier,
        sha256: paper.sha256,
        documentHash: article.prepared.documentHash,
        diagnostics,
        scenarios,
        pass: scenarios.every(scenario => scenario.pass) && matrixAudit.ok &&
          diagnostics.articleErrors.length === 0 && diagnostics.panelErrors.length === 0
      });
    } finally {
      await panel?.close().catch(() => undefined);
      await article.page.close().catch(() => undefined);
    }
  }
  const nativeAudit = auditNativeInspection({
    headedEdge: true, captures, reviews: inspection?.screenshots || {}
  });
  return {
    captures,
    profileRows: routeProof.profileRows,
    profileProof: routeProof,
    profileAudit,
    nativeAudit,
    papers: results,
    pass: profileAudit.ok && nativeAudit.ok &&
      results.length === requiredPapers.length && results.every(paper => paper.pass)
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const outputDir = path.resolve(args.output || 'output/literature-note-real-papers');
  const active = beginReport(outputDir);
  const reportFile = active.filename;
  let context;
  let profileDir;
  let profileRoot;
  let qaStage = 'input';
  try {
    const inputValue = String(args.input || env.LITERATURE_NOTE_QA_INPUT || '').trim();
    if (!inputValue) throw new Error('PENDING_EXTERNAL_INPUT: set --input or LITERATURE_NOTE_QA_INPUT');
    const inputPath = path.resolve(inputValue);
    if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
      throw new Error('PENDING_EXTERNAL_INPUT: private input file is missing');
    }
    const manifest = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const manifestAudit = validatePrivateManifest(manifest);
    if (!manifestAudit.ok) {
      throw new Error(`PENDING_EXTERNAL_INPUT: ${manifestAudit.issues[0] || 'private input invalid'}`);
    }
    const inspectionValue = String(args.inspection ||
      env.LITERATURE_NOTE_NATIVE_INSPECTION || '').trim();
    const inspectionPath = inspectionValue ? path.resolve(inspectionValue) : '';
    const hasInspection = Boolean(inspectionPath && fs.existsSync(inspectionPath) &&
      fs.statSync(inspectionPath).isFile());
    const inspection = hasInspection
      ? JSON.parse(fs.readFileSync(inspectionPath, 'utf8')) : {};
    let evidence;
    if (args.auditExisting === true) {
      qaStage = 'audit_existing';
      if (!hasInspection) {
        throw new Error('PENDING_EXTERNAL_INPUT: set --inspection for --audit-existing');
      }
      const receiptFile = path.join(outputDir, 'private-capture-receipt.json');
      if (!fs.existsSync(receiptFile) || !fs.statSync(receiptFile).isFile()) {
        throw new Error('PENDING_EXTERNAL_INPUT: private capture receipt is missing');
      }
      const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
      evidence = auditExistingCapture({ outputDir, manifest, receipt, inspection });
    } else {
      const extensionValue = String(args.extension || env.EXTENSION_PATH || '').trim();
      if (!extensionValue) throw new Error('PENDING_EXTERNAL_INPUT: set --extension or EXTENSION_PATH');
      const extensionPath = path.resolve(extensionValue);
      if (!fs.existsSync(extensionPath) || !fs.statSync(extensionPath).isDirectory()) {
        throw new Error('PENDING_EXTERNAL_INPUT: unpacked extension is missing');
      }
      if (env.HEADLESS !== '0') throw new Error('PENDING_EXTERNAL_INPUT: rerun in headed Edge');
      const trustedProfileValue = String(args.trustedProfile ||
        env.LITERATURE_NOTE_TRUSTED_PROFILE || '').trim();
      if (!trustedProfileValue) {
        throw new Error('PENDING_EXTERNAL_INPUT: set --trusted-profile or LITERATURE_NOTE_TRUSTED_PROFILE');
      }
      qaStage = 'launch';
      profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-literature-note-qa-'));
      profileDir = path.join(profileRoot, 'profile');
      seedTrustedProfile({ sourceDir: trustedProfileValue, targetDir: profileDir });
      const { chromium } = await import('playwright');
      const launched = await launchHeadedExtension({
        chromiumApi: chromium, profileDir, extensionPath
      });
      context = launched.context;
      qaStage = 'autofill';
      evidence = await runRealPaperGate({
        context, extensionPage: launched.extensionPage, extensionId: launched.extensionId,
        papers: manifest.papers, outputDir, inspection
      });
      const captureReceipt = buildCaptureReceipt({ manifest, evidence });
      writeCaptureReceiptOnce(outputDir, captureReceipt);
      evidence.captureSha256 = captureReceipt.captureSha256;
    }
    if (!hasInspection && args.auditExisting !== true) {
      qaStage = 'native_inspection';
      const reviews = Object.fromEntries(evidence.captures.map(capture => [capture.filename, {
        status: 'PENDING_EXTERNAL_INPUT', nativeResolution: false,
        sha256: capture.sha256, width: capture.width, height: capture.height,
        checks: {
          missingTextareasEmpty: false, statusVisible: false,
          spacingReadable: false, noOverlayObstruction: false
        },
        observation: ''
      }]));
      writeJsonAtomically(path.join(outputDir, 'native-inspection-template.json'), {
        schemaVersion: 1, captureSha256: evidence.captureSha256, screenshots: reviews
      });
      throw new Error('PENDING_EXTERNAL_INPUT: inspect generated screenshots at native resolution');
    }
    qaStage = args.auditExisting === true ? 'audit_existing' : 'report';
    const draftReport = buildPublicReport({
      papers: evidence.papers,
      status: evidence.pass ? 'PASS' : 'FAIL',
      security: { secretScanPassed: true, outputAllowlistPassed: true }
    });
    const securityAudit = auditPublicReport(draftReport);
    const publicReport = buildPublicReport({
      papers: evidence.papers,
      status: evidence.pass ? 'PASS' : 'FAIL',
      security: {
        secretScanPassed: securityAudit.secretScanPassed,
        outputAllowlistPassed: securityAudit.outputAllowlistPassed
      }
    });
    const provisional = { ...publicReport, pass: evidence.pass && securityAudit.ok };
    const finalSecurityAudit = auditPublicReport(provisional);
    const report = {
      ...provisional,
      security: {
        secretScanPassed: finalSecurityAudit.secretScanPassed,
        outputAllowlistPassed: finalSecurityAudit.outputAllowlistPassed
      },
      pass: provisional.pass && finalSecurityAudit.ok
    };
    writeJsonAtomically(reportFile, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return finalExitCode(report, auditPublicReport(report));
  } catch (error) {
    const safe = safeRuntimeFailure(error);
    const diagnostic = safeQaDiagnostic(error, qaStage);
    const report = pendingReport(error, diagnostic);
    writeJsonAtomically(reportFile, report);
    if (process.env.BREVESS_PRIVATE_QA_DIAGNOSTIC === '1') {
      process.stderr.write(`PRIVATE_DIAGNOSTIC ${JSON.stringify(
        privateRuntimeFailureDiagnostic(error)
      )}\n`);
    }
    process.stderr.write(`${safe}\n`);
    return safe.startsWith('PENDING_EXTERNAL_INPUT:') ? 2 : 1;
  } finally {
    await context?.close().catch(() => undefined);
    if (profileRoot && fs.existsSync(profileRoot)) {
      fs.rmSync(profileRoot, { recursive: true, force: true });
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) process.exitCode = await main();
