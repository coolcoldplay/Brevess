import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
let activeReport = null;

export const requiredPapers = Object.freeze([
  Object.freeze({
    key: 'neuron-2026-dopamine-circuits', kind: 'private',
    title: 'Receptor and cell-type-specific mechanisms in mesocortical dopamine circuits gate chronic pain and comorbid symptoms'
  }),
  Object.freeze({
    key: 'neuron-2020-hippocampal-ripples', kind: 'private',
    title: 'Routing of Hippocampal Ripples to Subcortical Structures via the Lateral Septum'
  }),
  Object.freeze({
    key: 'nat-neuro-2020-srpx2', kind: 'private',
    title: 'The endogenous neuronal complement inhibitor SRPX2 protects against complement-mediated synapse elimination during development'
  })
]);

export const publicRegressions = Object.freeze([
  Object.freeze({
    key: 'pmc12767537', kind: 'public-oa', pmcid: 'PMC12767537',
    title: 'Dysregulated Microglial Synaptic Engulfment in Diffuse Midline Glioma'
  }),
  Object.freeze({
    key: 'pmc12167935', kind: 'public-oa', pmcid: 'PMC12167935',
    title: 'Cancer-Associated Fibroblasts Foster a High-Lactate Microenvironment to Drive Perineural Invasion in Pancreatic Cancer'
  })
]);

export const checkChecklist = Object.freeze([
  'first_page_interactive', 'zoom_changes_width', 'fit_width_matches_container',
  'toggle_round_trip', 'selection_highlight_visible', 'selection_note_persisted',
  'selection_qa_grounded', 'saved_copy_reopens_with_annotation',
  'independent_reopen_verified', 'no_unhandled_error'
]);

export const screenshotChecklist = Object.freeze([
  'toolbar-80.png', 'toolbar-100.png', 'toolbar-fit-width.png',
  'parsed-document.png', 'native-document.png',
  'figure7-parsed.png', 'figure7-native.png',
  'selection-before-zoom.png', 'selection-after-zoom.png',
  'reopened-annotated-copy.png'
]);

const clean = (value, maximum = 500) => String(value ?? '')
  .normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maximum);
const isHash = value => /^[a-f0-9]{64}$/u.test(String(value || ''));

export function nativePdfDocumentHash(nativeDocument = {}) {
  const documentHash = String(nativeDocument?.structure?.documentHash || '').trim();
  return /^[a-f0-9]{64}$/iu.test(documentHash) ? documentHash.toLowerCase() : '';
}

function writeJsonAtomically(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filename);
}

function beginReport(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  activeReport = {
    filename: path.join(outputDir, 'qa-result.json'), runId: crypto.randomUUID(),
    generatedAt: new Date().toISOString()
  };
  writeJsonAtomically(activeReport.filename, {
    schemaVersion: 1, runId: activeReport.runId, generatedAt: activeReport.generatedAt,
    status: 'RUNNING', papers: [], pass: false
  });
}

function hashFile(filename) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let size;
    while ((size = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, size));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function profileDirectoryFingerprint(directory) {
  const hash = crypto.createHash('sha256');
  const visit = current => fs.readdirSync(current, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name)).forEach(entry => {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) throw new Error('PENDING_EXTERNAL_INPUT: trusted profile symlink is not allowed');
      hash.update(relative); hash.update('\0');
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) { hash.update(fs.readFileSync(absolute)); hash.update('\0'); }
    });
  visit(directory);
  return hash.digest('hex');
}

export function snapshotTrustedProfile(sourceDirectory, options = {}) {
  const sourceValue = String(sourceDirectory ?? '');
  if (!sourceValue.trim()) {
    throw new Error('PENDING_EXTERNAL_INPUT: trusted profile path is empty');
  }
  const sourceDir = path.resolve(sourceValue);
  let sourceMetadata;
  try { sourceMetadata = fs.lstatSync(sourceDir); } catch { sourceMetadata = null; }
  if (sourceMetadata?.isSymbolicLink()) {
    throw new Error('PENDING_EXTERNAL_INPUT: trusted profile root symlink/junction/reparse link is not allowed');
  }
  if (!sourceMetadata?.isDirectory()) {
    throw new Error('PENDING_EXTERNAL_INPUT: trusted profile directory is missing');
  }
  const sourceFingerprintSha256 = profileDirectoryFingerprint(sourceDir);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-reader-profile-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const copyDirectory = typeof options.copyDirectory === 'function'
    ? options.copyDirectory
    : (source, destination) => fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
  try {
    copyDirectory(sourceDir, userDataDir);
    const copyFingerprintSha256 = profileDirectoryFingerprint(userDataDir);
    const sourcePostCopyFingerprintSha256 = profileDirectoryFingerprint(sourceDir);
    if (sourcePostCopyFingerprintSha256 !== sourceFingerprintSha256) {
      throw new Error('PENDING_EXTERNAL_INPUT: trusted profile source changed during copy');
    }
    if (copyFingerprintSha256 !== sourceFingerprintSha256) {
      throw new Error('PENDING_EXTERNAL_INPUT: trusted profile copy fingerprint mismatch');
    }
  }
  catch (error) { fs.rmSync(tempRoot, { recursive: true, force: true }); throw error; }
  let cleaned = false;
  return Object.freeze({
    sourceFingerprintSha256, tempRoot, userDataDir,
    verifySourceUnchanged: () => profileDirectoryFingerprint(sourceDir) === sourceFingerprintSha256,
    cleanup: () => {
      if (cleaned) return;
      let unchanged = false;
      try { unchanged = profileDirectoryFingerprint(sourceDir) === sourceFingerprintSha256; }
      finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        cleaned = true;
      }
      if (!unchanged) throw new Error('TRUSTED_PROFILE_SOURCE_CHANGED');
    }
  });
}

async function pdfPageCount(filename) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(fs.readFileSync(filename));
  const document = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
  try { return document.numPages; } finally { await document.destroy(); }
}

async function inspectStandardAnnotation(filename, expectedPage, noteSha256) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(filename)), disableWorker: true
  }).promise;
  try {
    const matches = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: 'display' });
      for (const annotation of annotations) {
        const comment = clean(annotation?.contentsObj?.str || annotation?.contents || '', 2000);
        const commentSha256 = crypto.createHash('sha256').update(comment).digest('hex');
        if (Number(annotation?.annotationType) === 9 && commentSha256 === noteSha256) {
          matches.push({
            annotationType: 9, pageNumber,
            author: clean(annotation?.titleObj?.str || annotation?.title || annotation?.user || '', 80),
            commentSha256,
            quadPointCount: Array.isArray(annotation?.quadPoints) || ArrayBuffer.isView(annotation?.quadPoints)
              ? annotation.quadPoints.length : 0
          });
        }
      }
    }
    return matches.length === 1 ? { ...matches[0], matchCount: 1 } : {
      annotationType: matches[0]?.annotationType || 0, pageNumber: matches[0]?.pageNumber || 0,
      author: matches[0]?.author || '', commentSha256: matches[0]?.commentSha256 || '',
      quadPointCount: matches[0]?.quadPointCount || 0, matchCount: matches.length
    };
  } finally {
    await document.destroy();
  }
}

export function extensionBuildBinding(extensionPath) {
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const files = [];
  const visit = directory => fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name)).forEach(entry => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    });
  visit(extensionPath);
  const build = crypto.createHash('sha256');
  for (const filename of files) {
    build.update(path.relative(extensionPath, filename).replaceAll('\\', '/'));
    build.update('\0');
    build.update(fs.readFileSync(filename));
    build.update('\0');
  }
  return Object.freeze({
    name: clean(manifest.name, 160), version: clean(manifest.version, 80),
    manifestVersion: Number(manifest.manifest_version) || 0,
    manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
    buildSha256: build.digest('hex')
  });
}

export function auditPaperEvidence(value = {}) {
  const checks = Object.fromEntries(checkChecklist.map(name => [name, value.checks?.[name] === true]));
  const missing = checkChecklist.filter(name => !checks[name]);
  const unhandledErrors = Math.max(0, Number(value.unhandledErrors) || 0);
  return Object.freeze({ ok: missing.length === 0 && unhandledErrors === 0, checks, missing, unhandledErrors });
}

export function auditToolbarCaptures(items = []) {
  const byName = new Map((Array.isArray(items) ? items : []).map(item => [item?.filename, item]));
  const eighty = byName.get('toolbar-80.png');
  const hundred = byName.get('toolbar-100.png');
  const fit = byName.get('toolbar-fit-width.png');
  const exact80 = Number(eighty?.requestedScale) === 0.8 && clean(eighty?.displayedValue, 20) === '80%';
  const exact100 = Number(hundred?.requestedScale) === 1 && clean(hundred?.displayedValue, 20) === '100%';
  const fitWidth = fit?.fitWidth === true && Number(fit?.pageWidth) > 0 &&
    Math.abs(Number(fit.pageWidth) - Number(fit.containerWidth)) <= 48;
  return Object.freeze({ ok: exact80 && exact100 && fitWidth, exact80, exact100, fitWidth });
}

export function auditFigureTargetCaptures(target = {}, captures = []) {
  const required = new Map((Array.isArray(captures) ? captures : [])
    .map(item => [item?.mode, item]));
  const matches = mode => {
    const item = required.get(mode);
    const rect = item?.targetRect || {};
    return Boolean(item?.filename === `figure7-${mode}.png` && item?.targetVisible === true &&
      clean(item.figureId, 100) === clean(target.figureId, 100) &&
      Number(item.pageNumber) === Number(target.pageNumber) &&
      isHash(item.observedMarkerSha256) && item.observedMarkerSha256 === target.markerSha256 &&
      Number(rect.width) > 0 && Number(rect.height) > 0);
  };
  return Object.freeze({ ok: matches('parsed') && matches('native'), parsed: matches('parsed'), native: matches('native') });
}

export function auditProviderProbe(expected = {}, receipt = {}) {
  const ok = isHash(expected.profileFingerprintSha256) &&
    expected.profileFingerprintSha256 === receipt.profileFingerprintSha256 &&
    clean(expected.profileId, 120) === clean(receipt.profileId, 120) &&
    clean(expected.providerId, 80) === clean(receipt.providerId, 80) &&
    receipt.ready === true && clean(receipt.operationId, 160).length > 0 &&
    !Number.isNaN(Date.parse(receipt.checkedAt));
  return Object.freeze({ ok });
}

export async function probeTrustedExistingProfile(sendRuntimeMessage, expected = {}) {
  if (typeof sendRuntimeMessage !== 'function') throw new Error('EXTENSION_CONTROL_PAGE_REQUIRED');
  const loaded = await sendRuntimeMessage({ type: 'LLM_GET_SETTINGS' });
  const settings = loaded?.data?.settings;
  const profile = settings?.profiles?.[expected.profileId];
  const providerId = clean(expected.providerId || profile?.providerId, 80);
  if (!loaded?.success || settings?.consentGranted !== true || !profile ||
      clean(profile.id || expected.profileId, 120) !== clean(expected.profileId, 120) ||
      !providerId || clean(profile.providerId, 80) !== providerId) {
    throw new Error('PENDING_EXTERNAL_INPUT: trusted profile or consent is unavailable');
  }
  const selectedProbeIds = Array.isArray(expected.probeIds) && expected.probeIds.length
    ? expected.probeIds : ['structured_schema'];
  const requestedProbeIds = [...new Set(selectedProbeIds
    .map(id => clean(id, 80)).filter(Boolean))];
  if (!requestedProbeIds.length) requestedProbeIds.push('structured_schema');
  const tested = await sendRuntimeMessage({
    type: 'LLM_TEST_PROFILE', profileId: expected.profileId,
    probeIds: requestedProbeIds
  });
  const probesAreArray = Array.isArray(tested?.data?.probes);
  const probes = probesAreArray ? tested.data.probes : [];
  const responseProbeIds = probes.map(probe => typeof probe?.id === 'string' ? probe.id : '');
  const probesWellFormed = probesAreArray && probes.every((probe, index) =>
    probe && typeof probe === 'object' && !Array.isArray(probe) &&
    responseProbeIds[index].length > 0 && clean(responseProbeIds[index], 80) === responseProbeIds[index] &&
    probe.status === 'passed');
  const probesAreUnique = new Set(responseProbeIds).size === responseProbeIds.length;
  const exactRequestedProbesPassed = probesWellFormed && probesAreUnique &&
    responseProbeIds.length === requestedProbeIds.length &&
    requestedProbeIds.every(id => responseProbeIds.includes(id));
  if (!tested?.success || clean(tested?.data?.profileId, 120) !== clean(expected.profileId, 120) ||
      clean(tested?.data?.providerId, 80) !== providerId || tested?.data?.connected !== true ||
      !exactRequestedProbesPassed) {
    throw new Error('PENDING_EXTERNAL_INPUT: trusted profile readiness probe failed');
  }
  return { ready: true, profileId: clean(expected.profileId, 120),
    providerId };
}

export function waitForProductionQaResponse(subscribe, expected = {}, options = {}) {
  const clickedAt = Number(options.clickedAt) || Date.now();
  const identityReady = isHash(expected.selectionDocumentSha256) &&
    isHash(expected.evidenceSha256) && Number(expected.pageNumber) > 0 &&
    clean(expected.sourceId, 160) === `pdf-page-${Number(expected.pageNumber)}` &&
    options.profileInFlight === false;
  const baseline = new Set(Array.isArray(options.baselineOperationIds)
    ? options.baselineOperationIds.map(String) : []);
  const timeoutMs = Math.max(1, Math.min(120000, Number(options.timeoutMs) || 120000));
  return new Promise((resolve, reject) => {
    let dispose = () => {};
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); dispose();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('PDF_QA_RESPONSE_TIMEOUT')), timeoutMs);
    if (!identityReady) {
      finish(new Error('PDF_QA_PRECLICK_STATE_INVALID'));
      return;
    }
    const started = new Map();
    dispose = subscribe(event => {
      const turn = event?.turn || event;
      const operationId = clean(turn?.operationId, 160);
      if (!operationId || baseline.has(operationId)) return;
      const phase = clean(event?.phase, 80);
      if (phase === 'chat_started') {
        if (Number(turn?.createdAt) < clickedAt) return;
        started.set(operationId, Number(turn.createdAt));
        if (started.size > 1) {
          finish(new Error('PDF_QA_CONCURRENT_OPERATION'));
        }
        return;
      }
      if (phase !== 'chat_completed' || turn?.status !== 'completed') return;
      if (!started.has(operationId)) {
        finish(new Error('PDF_QA_COMPLETION_WITHOUT_START'));
        return;
      }
      const evidence = (Array.isArray(turn?.answerBlocks) ? turn.answerBlocks : [])
        .flatMap(block => Array.isArray(block?.evidence) ? block.evidence : []);
      const current = started.size === 1 && Number(turn?.createdAt) >= clickedAt &&
        clean(turn?.selectedProfileId, 120) === clean(expected.profileId, 120) &&
        evidence.some(item => clean(item?.sourceKey, 160) === clean(expected.sourceId, 160) &&
          clean(item?.paragraphId, 160) === clean(expected.sourceId, 160) &&
          clean(item?.textHash, 64).toLowerCase() === expected.evidenceSha256);
      if (!current) return;
      finish(null, { ...turn, startedAt: started.get(operationId),
        completedAt: Math.max(Number(turn.updatedAt) || 0, Date.now()) });
    });
  });
}

export function auditGroundedSelectionQa(expected = {}, answer = {}) {
  const identityMatches = ['actionId', 'profileId', 'sourceId']
    .every(key => clean(expected?.[key], 160) && clean(expected[key], 160) === clean(answer?.[key], 160)) &&
    Number(expected.pageNumber) > 0 && Number(expected.pageNumber) === Number(answer.pageNumber) &&
    clean(expected.sourceId, 160) === `pdf-page-${Number(expected.pageNumber)}` &&
    isHash(expected.evidenceSha256) && expected.evidenceSha256 === answer.evidenceSha256 &&
    isHash(expected.selectionDocumentSha256) &&
    expected.selectionDocumentSha256 === answer.selectionDocumentSha256 &&
    Number(answer.startedAt) >= Number(expected.clickedAt) &&
    Number(answer.completedAt) >= Number(answer.startedAt) && Number(expected.clickedAt) > 0;
  const citationMatches = (Array.isArray(answer.citations) ? answer.citations : []).some(citation =>
    Number(citation?.pageNumber) === Number(expected.pageNumber) &&
    clean(citation?.sourceId, 160) === clean(expected.sourceId, 160) &&
    clean(citation?.evidenceSha256, 64).toLowerCase() === expected.evidenceSha256);
  return Object.freeze({
    ok: identityMatches && citationMatches && clean(answer.answerText, 1000).length > 0 &&
      clean(answer.operationId, 160).length > 0,
    identityMatches, citationMatches
  });
}

export function auditCapturedQaReceipt(receipt = {}) {
  return receipt.ok === true && receipt.identityMatches === true &&
    receipt.citationMatches === true && clean(receipt.operationId, 160).length > 0 &&
    Number(receipt.clickedAt) > 0 && Number(receipt.startedAt) >= Number(receipt.clickedAt) &&
    Number(receipt.completedAt) >= Number(receipt.startedAt) &&
    Number(receipt.pageNumber) > 0 &&
    clean(receipt.sourceId, 160) === `pdf-page-${Number(receipt.pageNumber)}` &&
    isHash(receipt.evidenceSha256) && isHash(receipt.selectionDocumentSha256);
}

export function auditDiagnostics(value = {}) {
  const pageErrors = Array.isArray(value.pageErrors) ? value.pageErrors : [];
  const consoleErrors = Array.isArray(value.consoleErrors) ? value.consoleErrors : [];
  const workerErrors = Array.isArray(value.workerErrors) ? value.workerErrors : [];
  const pageCrashes = Math.max(0, Number(value.pageCrashes) || 0);
  const contextInvalidations = Math.max(0, Number(value.contextInvalidations) || 0);
  const count = pageErrors.length + consoleErrors.length + workerErrors.length +
    pageCrashes + contextInvalidations;
  return Object.freeze({ ok: count === 0, count, pageErrors, consoleErrors,
    workerErrors, pageCrashes, contextInvalidations });
}

export function auditReopenedAnnotation(expected = {}, observed = {}) {
  const standard = observed?.standard || {};
  const identityMatches = clean(expected.annotationId, 200) &&
    clean(expected.annotationId, 200) === clean(observed.annotationId, 200) &&
    Number(expected.pageNumber) > 0 && Number(expected.pageNumber) === Number(observed.pageNumber) &&
    isHash(expected.noteSha256) && expected.noteSha256 === observed.noteSha256;
  const standardMatches = Number(standard.annotationType) === 9 &&
    Number(standard.pageNumber) === Number(expected.pageNumber) &&
    clean(standard.author, 80) === 'Brevess' &&
    standard.commentSha256 === expected.noteSha256 && Number(standard.quadPointCount) >= 8 &&
    Number(standard.matchCount) === 1 && Number(observed.overlayMatchCount) === 1;
  return Object.freeze({ ok: Boolean(identityMatches && standardMatches), identityMatches, standardMatches });
}

export function countExactAnnotationIdentity(records = [], expected = {}) {
  return (Array.isArray(records) ? records : []).filter(record =>
    clean(record?.annotationId, 200) === clean(expected.annotationId, 200) &&
    Number(record?.pageNumber) === Number(expected.pageNumber) &&
    clean(record?.noteSha256, 64).toLowerCase() === clean(expected.noteSha256, 64).toLowerCase()
  ).length;
}

export function auditTargetedLayoutInspection(expected = {}, observed = {}, inspection = {}) {
  const observedByKey = new Map((Array.isArray(observed.targets) ? observed.targets : [])
    .map(target => [clean(target?.key, 100), target]));
  const reviewByKey = new Map((Array.isArray(inspection.targets) ? inspection.targets : [])
    .map(target => [clean(target?.key, 100), target]));
  const targets = Array.isArray(expected.targets) ? expected.targets : [];
  const targetBindingsOk = targets.length > 0 && targets.every(target => {
    const live = observedByKey.get(clean(target.key, 100));
    const review = reviewByKey.get(clean(target.key, 100));
    const binding = candidate => candidate &&
      Number(candidate.pageNumber) === Number(target.pageNumber) &&
      clean(candidate.markerSha256, 64).toLowerCase() === target.markerSha256;
    return binding(live) && live.targetVisible === true && live.semanticVerified === true &&
      clean(live.semantic, 80) === clean(target.semantic, 80) &&
      binding(review) && review.status === 'PASS';
  });
  const inspectionBindingOk = inspection?.status === 'PASS' &&
    inspection?.originalPdfReviewed === true && clean(inspection?.observation, 300).length > 0 &&
    clean(inspection?.paperKey, 100) === clean(expected.paperKey, 100) &&
    isHash(expected.pdfSha256) && clean(inspection?.pdfSha256, 64).toLowerCase() === expected.pdfSha256;
  return Object.freeze({ ok: targetBindingsOk && inspectionBindingOk,
    targetBindingsOk, inspectionBindingOk });
}

const neuronLayoutChecks = Object.freeze([
  'referenceOrdinalsIncrease', 'figure7StatisticsNotDuplicatedAsBody',
  'italicsPreserved', 'd1D2SuperscriptsPreserved', 'h2oSubscriptPreserved',
  'overbarAndLegacyTexResolved'
]);
const oaLayoutChecks = Object.freeze(['parsedCaptionBoundariesPass', 'typographyPass']);

export function auditLayoutRegression(paperKey, value = {}) {
  const required = paperKey === 'neuron-2026-dopamine-circuits'
    ? neuronLayoutChecks : paperKey.startsWith('pmc') ? oaLayoutChecks : [];
  const checks = Object.fromEntries(required.map(name => [name, value?.[name] === true]));
  const missing = required.filter(name => !checks[name]);
  return Object.freeze({ ok: required.length === 0 || missing.length === 0, checks, missing });
}

export function auditNativeInspection(value = {}, evidence = []) {
  const reviews = value?.screenshots && typeof value.screenshots === 'object'
    ? value.screenshots : {};
  const missing = [];
  const mismatched = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const filename = path.basename(clean(item?.filename, 200));
    const review = reviews[filename];
    if (review?.status !== 'PASS' || review?.nativeResolution !== true ||
        !clean(review?.observation, 300)) {
      missing.push(filename);
    } else if (clean(review.sha256, 64).toLowerCase() !== clean(item.sha256, 64).toLowerCase() ||
        Number(review.width) !== Number(item.width) || Number(review.height) !== Number(item.height)) {
      mismatched.push(filename);
    }
  }
  return Object.freeze({
    ok: evidence.length > 0 && missing.length === 0 && mismatched.length === 0,
    reviewed: Math.max(0, evidence.length - missing.length - mismatched.length),
    required: evidence.length, missing, mismatched
  });
}

export function auditExternalReaderInspection(value = {}, binding = {}) {
  const bindingMatches = [
    'paperKey', 'sourcePdfSha256', 'annotatedPdfSha256', 'annotationIdentitySha256'
  ]
    .every(key => clean(value?.[key], 100).toLowerCase() === clean(binding?.[key], 100).toLowerCase()) &&
    Number(value?.pageCount) === Number(binding?.pageCount) &&
    Number(value?.annotationCount) === Number(binding?.annotationCount);
  const ok = value?.status === 'PASS' && value?.openedOutsideExtension === true &&
    value?.allAnnotationsVisible === true && value?.bodyReadable === true &&
    clean(value?.observation, 300).length > 0 && bindingMatches;
  return Object.freeze({ ok, bindingMatches, openedOutsideExtension: value?.openedOutsideExtension === true });
}

function captureArtifactPayload(value = {}) {
  const control = value.globalReceipt?.controlPageDiagnostics || {};
  return {
    captureRunId: clean(value.captureRunId, 80),
    capturePass: value.capturePass === true,
    providerProbeSha256: clean(value.providerProbeSha256, 64).toLowerCase(),
    extensionBuildSha256: clean(value.extensionBuildSha256, 64).toLowerCase(),
    globalReceipt: { ok: value.globalReceipt?.ok === true,
      controlPageDiagnostics: { ok: control.ok === true,
        count: Math.max(0, Number(control.count) || 0),
        pageErrors: Math.max(0, Number(control.pageErrors) || 0),
        consoleErrors: Math.max(0, Number(control.consoleErrors) || 0),
        pageCrashes: Math.max(0, Number(control.pageCrashes) || 0),
        contextInvalidations: Math.max(0, Number(control.contextInvalidations) || 0) } },
    papers: (Array.isArray(value.papers) ? value.papers : []).map(paper => ({
      key: clean(paper?.key, 100), sourcePdfSha256: clean(paper?.sourcePdfSha256, 64).toLowerCase(),
      annotatedPdfSha256: clean(paper?.annotatedPdfSha256, 64).toLowerCase(),
      pageCount: Number(paper?.pageCount) || 0, annotationCount: Number(paper?.annotationCount) || 0,
      annotationIdentitySha256: clean(paper?.annotationIdentitySha256, 64).toLowerCase(),
      screenshots: boundedEvidence(paper?.screenshots),
      receipt: paper?.receipt || null,
      artifacts: paper?.artifacts || null
    })).sort((left, right) => left.key.localeCompare(right.key))
  };
}

export function buildCaptureArtifactHash(value = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(captureArtifactPayload(value))).digest('hex');
}

export function auditExistingCapture(value = {}) {
  const payload = captureArtifactPayload(value);
  const requiredKeys = [...requiredPapers, ...publicRegressions].map(paper => paper.key).sort();
  const capturedKeys = payload.papers.map(paper => paper.key).sort();
  const exactPaperSet = JSON.stringify(capturedKeys) === JSON.stringify(requiredKeys);
  const expectedScreens = key => screenshotChecklist
    .filter(name => key === 'neuron-2026-dopamine-circuits' || !name.startsWith('figure7-'));
  const papersValid = exactPaperSet && payload.papers.every(paper =>
    paper.key && isHash(paper.sourcePdfSha256) && isHash(paper.annotatedPdfSha256) &&
    isHash(paper.annotationIdentitySha256) && paper.pageCount > 0 && paper.annotationCount > 0 &&
    JSON.stringify(paper.screenshots.map(item => item.filename).sort()) ===
      JSON.stringify(expectedScreens(paper.key).sort()) &&
    paper.screenshots.every(item => item.filename && isHash(item.sha256) && item.width > 0 && item.height > 0) &&
    paper.receipt?.checksOk === true && paper.receipt?.layoutOk === true &&
    paper.receipt?.diagnosticsOk === true && paper.receipt?.toolbarOk === true &&
    paper.receipt?.figureOk === true && paper.receipt?.qaOk === true &&
    auditCapturedQaReceipt(paper.receipt?.qa) &&
    paper.receipt?.standardAnnotationOk === true && paper.receipt?.independentReopenOk === true &&
    clean(paper.artifacts?.annotatedPdf?.relativePath, 300) &&
    isHash(paper.artifacts?.annotatedPdf?.sha256) && Number(paper.artifacts?.annotatedPdf?.size) > 0 &&
    Array.isArray(paper.artifacts?.screenshots) &&
    paper.artifacts.screenshots.length === expectedScreens(paper.key).length &&
    paper.artifacts.screenshots.every(artifact => {
      const evidence = paper.screenshots.find(item => item.filename === artifact.filename);
      return evidence && clean(artifact.relativePath, 300) && !path.isAbsolute(artifact.relativePath) &&
        !String(artifact.relativePath).replaceAll('\\', '/').split('/').includes('..') &&
        artifact.sha256 === evidence.sha256 && Number(artifact.width) === evidence.width &&
        Number(artifact.height) === evidence.height && Number(artifact.size) > 0;
    }));
  const identityValid = /^[a-f0-9-]{36}$/iu.test(payload.captureRunId) &&
    isHash(payload.extensionBuildSha256) && isHash(payload.providerProbeSha256) &&
    payload.globalReceipt.ok === true && payload.globalReceipt.controlPageDiagnostics.ok === true &&
    payload.globalReceipt.controlPageDiagnostics.count === 0;
  const expected = buildCaptureArtifactHash(payload);
  return Object.freeze({
    ok: payload.capturePass === false && identityValid && papersValid &&
      expected === clean(value.artifactSha256, 64).toLowerCase(),
    expectedArtifactSha256: expected
  });
}

function boundedEvidence(items, maximum = screenshotChecklist.length) {
  return (Array.isArray(items) ? items : []).slice(0, maximum).map(item => ({
    filename: path.basename(clean(item?.filename, 200)),
    sha256: isHash(item?.sha256) ? String(item.sha256).toLowerCase() : '',
    width: Math.max(0, Number(item?.width) || 0),
    height: Math.max(0, Number(item?.height) || 0)
  }));
}

export function publicPaperResult(value = {}) {
  const safeRelative = candidate => {
    const normalized = String(candidate || '').replaceAll('\\', '/');
    return normalized && !path.isAbsolute(normalized) && !normalized.split('/').includes('..')
      ? normalized : '';
  };
  const receipt = value.receipt || {};
  const safeReceipt = {
    checksOk: receipt.checksOk === true,
    checks: Object.fromEntries(checkChecklist.map(name => [name, receipt.checks?.[name] === true])),
    layoutOk: receipt.layoutOk === true,
    layout: Object.fromEntries([...neuronLayoutChecks, ...oaLayoutChecks]
      .filter(name => Object.hasOwn(receipt.layout || {}, name))
      .map(name => [name, receipt.layout[name] === true])),
    diagnosticsOk: receipt.diagnosticsOk === true,
    diagnostics: Object.fromEntries(['pageErrors', 'consoleErrors', 'workerErrors',
      'pageCrashes', 'contextInvalidations'].map(name => [name, Number(receipt.diagnostics?.[name]) || 0])),
    toolbarOk: receipt.toolbarOk === true, toolbar: { ok: receipt.toolbar?.ok === true,
      exact80: receipt.toolbar?.exact80 === true, exact100: receipt.toolbar?.exact100 === true,
      fitWidth: receipt.toolbar?.fitWidth === true },
    figureOk: receipt.figureOk === true, figure: { ok: receipt.figure?.ok === true,
      parsed: receipt.figure?.parsed === true, native: receipt.figure?.native === true,
      notApplicable: receipt.figure?.notApplicable === true },
    qaOk: receipt.qaOk === true, qa: { ok: receipt.qa?.ok === true,
      identityMatches: receipt.qa?.identityMatches === true,
      citationMatches: receipt.qa?.citationMatches === true,
      operationId: clean(receipt.qa?.operationId, 160),
      clickedAt: Math.max(0, Number(receipt.qa?.clickedAt) || 0),
      startedAt: Math.max(0, Number(receipt.qa?.startedAt) || 0),
      completedAt: Math.max(0, Number(receipt.qa?.completedAt) || 0),
      pageNumber: Math.max(0, Number(receipt.qa?.pageNumber) || 0),
      sourceId: clean(receipt.qa?.sourceId, 160),
      evidenceSha256: isHash(receipt.qa?.evidenceSha256) ? receipt.qa.evidenceSha256 : '',
      selectionDocumentSha256: isHash(receipt.qa?.selectionDocumentSha256)
        ? receipt.qa.selectionDocumentSha256 : '' },
    standardAnnotationOk: receipt.standardAnnotationOk === true,
    standardAnnotation: { annotationType: Number(receipt.standardAnnotation?.annotationType) || 0,
      pageNumber: Number(receipt.standardAnnotation?.pageNumber) || 0,
      author: clean(receipt.standardAnnotation?.author, 80),
      commentSha256: isHash(receipt.standardAnnotation?.commentSha256)
        ? receipt.standardAnnotation.commentSha256 : '',
      quadPointCount: Number(receipt.standardAnnotation?.quadPointCount) || 0,
      matchCount: Number(receipt.standardAnnotation?.matchCount) || 0 },
    independentReopenOk: receipt.independentReopenOk === true,
    independentReopen: { ok: receipt.independentReopen?.ok === true,
      identityMatches: receipt.independentReopen?.identityMatches === true,
      standardMatches: receipt.independentReopen?.standardMatches === true }
  };
  const safeArtifacts = {
    annotatedPdf: {
      relativePath: safeRelative(value.artifacts?.annotatedPdf?.relativePath),
      sha256: isHash(value.artifacts?.annotatedPdf?.sha256)
        ? value.artifacts.annotatedPdf.sha256 : '',
      size: Math.max(0, Number(value.artifacts?.annotatedPdf?.size) || 0)
    },
    screenshots: (Array.isArray(value.artifacts?.screenshots) ? value.artifacts.screenshots : [])
      .slice(0, screenshotChecklist.length).map(item => ({
        filename: path.basename(clean(item?.filename, 200)),
        relativePath: safeRelative(item?.relativePath),
        sha256: isHash(item?.sha256) ? item.sha256 : '', width: Number(item?.width) || 0,
        height: Number(item?.height) || 0, size: Number(item?.size) || 0
      }))
  };
  return {
    key: clean(value.key, 100), kind: clean(value.kind, 24), title: clean(value.title, 500),
    doi: clean(value.doi, 160), pmid: clean(value.pmid, 40), pmcid: clean(value.pmcid, 40),
    sha256: isHash(value.sha256) ? String(value.sha256).toLowerCase() : '',
    pageCount: Number.isSafeInteger(value.pageCount) && value.pageCount > 0 ? value.pageCount : 0,
    checks: {
      ok: value.checks?.ok === true,
      completed: Object.fromEntries(checkChecklist.map(name => [name,
        value.checks?.completed?.[name] === true || value.checks?.checks?.[name] === true]))
    },
    layout: {
      ok: value.layout?.ok === true,
      completed: Object.fromEntries([...neuronLayoutChecks, ...oaLayoutChecks]
        .filter(name => Object.hasOwn(value.layout?.completed || value.layout?.checks || {}, name))
        .map(name => [name, (value.layout?.completed || value.layout?.checks)?.[name] === true]))
    },
    screenshots: {
      ok: value.screenshots?.ok === true,
      evidence: boundedEvidence(value.screenshots?.evidence)
    },
    nativeInspection: {
      ok: value.nativeInspection?.ok === true,
      reviewed: Math.max(0, Number(value.nativeInspection?.reviewed) || 0),
      required: Math.max(0, Number(value.nativeInspection?.required) || 0),
      missing: (Array.isArray(value.nativeInspection?.missing) ? value.nativeInspection.missing : [])
        .slice(0, screenshotChecklist.length).map(item => path.basename(clean(item, 200))),
      mismatched: (Array.isArray(value.nativeInspection?.mismatched) ? value.nativeInspection.mismatched : [])
        .slice(0, screenshotChecklist.length).map(item => path.basename(clean(item, 200)))
    },
    externalReaderInspection: { ok: value.externalReaderInspection?.ok === true },
    artifact: {
      sourcePdfSha256: isHash(value.artifact?.sourcePdfSha256) ? value.artifact.sourcePdfSha256 : '',
      annotatedPdfSha256: isHash(value.artifact?.annotatedPdfSha256) ? value.artifact.annotatedPdfSha256 : '',
      annotationIdentitySha256: isHash(value.artifact?.annotationIdentitySha256)
        ? value.artifact.annotationIdentitySha256 : '',
      annotationCount: Math.max(0, Number(value.artifact?.annotationCount) || 0)
    },
    receipt: safeReceipt,
    artifacts: safeArtifacts,
    diagnostics: { unhandledErrors: Math.max(0, Number(value.diagnostics?.unhandledErrors) || 0) },
    pass: value.pass === true
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else if (argv[index] === '--extension') options.extension = argv[++index];
    else if (argv[index] === '--trusted-profile') options.trustedProfile = argv[++index];
    else if (argv[index] === '--inspection') options.inspection = argv[++index];
    else if (argv[index] === '--original-inspection') options.originalInspection = argv[++index];
    else if (argv[index] === '--external-inspection') options.externalInspection = argv[++index];
    else if (argv[index] === '--audit-existing') options.auditExisting = argv[++index];
    else if (argv[index] === '--help') options.help = true;
  }
  return options;
}

function helpText() {
  return [
    'PDF reader real-paper verifier',
    'Usage: node scripts/verify-pdf-reader-real-papers.mjs --input <private-input.json>',
    '  --extension <unpacked-extension> [--output <artifact-dir>]',
    '  --trusted-profile <existing-Edge-user-data-directory>',
    '  [--inspection <private-native-inspection.json>]',
    '  [--original-inspection <private-original-PDF-layout-inspection.json>]',
    '  [--external-inspection <private-independent-reader-inspection.json>]',
    '  [--audit-existing <capture-qa-result.json>]',
    '',
    'The input, local/Zotero paths, annotated PDFs, screenshots, and inspections stay outside Git.',
    'PASS requires headed Edge, current screenshot review at native resolution, and an',
    'independent PDF reader inspection bound to the saved-copy hash.'
  ].join('\n');
}

function readPrivateJson(filename, missingMessage) {
  const resolved = filename ? path.resolve(filename) : '';
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`PENDING_EXTERNAL_INPUT: ${missingMessage}`);
  }
  return { path: resolved, value: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
}

async function validateInput(raw) {
  const candidates = Array.isArray(raw?.papers) ? raw.papers : [];
  const validated = [];
  for (const required of [...requiredPapers, ...publicRegressions]) {
    const candidate = candidates.find(item => item?.key === required.key);
    if (!candidate) throw new Error(`PENDING_EXTERNAL_INPUT: missing ${required.key}`);
    if (clean(candidate.title, 500) !== required.title) {
      throw new Error(`PENDING_EXTERNAL_INPUT: title mismatch for ${required.key}`);
    }
    const pdfInput = clean(candidate.pdfPath || candidate.zoteroAttachmentPath, 4000);
    const pdfPath = pdfInput ? path.resolve(pdfInput) : '';
    if (!pdfPath || !fs.existsSync(pdfPath) || !fs.statSync(pdfPath).isFile()) {
      throw new Error(`PENDING_EXTERNAL_INPUT: PDF missing for ${required.key}`);
    }
    if (!isHash(candidate.sha256) || hashFile(pdfPath) !== String(candidate.sha256).toLowerCase()) {
      throw new Error(`PENDING_EXTERNAL_INPUT: PDF hash mismatch for ${required.key}`);
    }
    if (!Number.isSafeInteger(candidate.pageCount) || candidate.pageCount < 1) {
      throw new Error(`PENDING_EXTERNAL_INPUT: pageCount missing for ${required.key}`);
    }
    if (await pdfPageCount(pdfPath) !== candidate.pageCount) {
      throw new Error(`PENDING_EXTERNAL_INPUT: pageCount mismatch for ${required.key}`);
    }
    if (required.kind === 'private' && !clean(candidate.doi || candidate.pmid, 160)) {
      throw new Error(`PENDING_EXTERNAL_INPUT: DOI or PMID missing for ${required.key}`);
    }
    validated.push({ ...candidate, ...required, pdfPath });
  }
  return validated;
}

function diagnosticsFor(page, worker) {
  const state = {
    pageErrors: [], consoleErrors: [], pageCrashes: 0,
    workerErrors: [], contextInvalidations: 0
  };
  const isInvalidation = value => /extension context invalidated|receiving end does not exist/iu.test(value);
  page.on('pageerror', error => {
    const message = clean(error?.message, 200);
    state.pageErrors.push(message);
    if (isInvalidation(message)) state.contextInvalidations += 1;
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const value = clean(message.text(), 200);
    state.consoleErrors.push(value);
    if (isInvalidation(value)) state.contextInvalidations += 1;
  });
  page.on('crash', () => { state.pageCrashes += 1; });
  worker?.on?.('console', message => {
    if (message.type() !== 'error') return;
    const value = clean(message.text(), 200);
    state.workerErrors.push(value);
    if (isInvalidation(value)) state.contextInvalidations += 1;
  });
  return state;
}

export async function runWithControlPageDiagnostics(controlPage, operation) {
  const state = diagnosticsFor(controlPage, null);
  try {
    const value = await operation();
    const diagnostics = auditDiagnostics(state);
    if (!diagnostics.ok) throw new Error('CONTROL_PAGE_DIAGNOSTICS_FAILED');
    return { value, diagnostics };
  } finally {
    await controlPage.close();
  }
}

async function pngEvidence(filename) {
  const { PNG } = await import('pngjs');
  const png = PNG.sync.read(fs.readFileSync(filename));
  return { filename: path.basename(filename), sha256: hashFile(filename), width: png.width,
    height: png.height, size: fs.statSync(filename).size };
}

async function capture(page, paperDir, filename) {
  const output = path.join(paperDir, filename);
  await page.screenshot({ path: output, fullPage: false });
  return pngEvidence(output);
}

async function selectNativeText(page) {
  return page.evaluate(() => {
    const documentHash = String(
      globalThis.__brevessNativePdfDocument?.structure?.documentHash || ''
    ).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(documentHash)) return null;
    const span = document.querySelector('.pdf-native-text-layer span');
    if (!span?.firstChild || !String(span.textContent || '').trim()) return null;
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const pageNumber = Number(span.closest('[data-pdf-page-number]')?.dataset?.pdfPageNumber) || 0;
    return {
      text: String(span.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim(),
      pageNumber,
      documentHash,
      sourceId: `pdf-page-${pageNumber}`
    };
  });
}

async function setExactScale(page, scale, expected) {
  const applied = await page.evaluate(async requested =>
    globalThis.__brevessPdfReaderBridge?.command?.('setScale', requested), scale);
  if (!Number.isFinite(Number(applied))) throw new Error('PDF_QA_SCALE_COMMAND_FAILED');
  await page.locator('#pdfReaderZoomValue').filter({ hasText: expected })
    .waitFor({ state: 'visible', timeout: 10000 });
  const displayedValue = clean(await page.locator('#pdfReaderZoomValue').textContent(), 20);
  if (displayedValue !== expected) throw new Error('PDF_QA_SCALE_DISPLAY_MISMATCH');
  return displayedValue;
}

async function inspectLiveLayout(page, paper) {
  if (paper.key !== 'neuron-2026-dopamine-circuits' && !paper.key.startsWith('pmc')) {
    return auditLayoutRegression(paper.key, {});
  }
  const startParse = page.locator('#pdfReaderStartParse');
  if (await startParse.isVisible()) await startParse.click();
  await page.locator('html[data-pdf-workspace-rendered="true"]')
    .waitFor({ state: 'attached', timeout: 120000 });
  const probes = {
    referenceListSelector: clean(paper.automation?.referenceListSelector, 300),
    figure7StatisticProbe: clean(paper.automation?.figure7StatisticProbe, 300)
  };
  const observed = await page.evaluate(({ paperKey, probes: liveProbes }) => {
    const article = document.querySelector('#pdfReaderArticle');
    if (!article) return {};
    const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const rawText = normalize(article.textContent);
    const hasRawTex = /\\(?:mathbf|mathrm|mathit|overline|bar|textit|textbf)\b|\$\^?\{|\$_?\{/u
      .test(rawText);
    if (paperKey.startsWith('pmc')) {
      const captions = [...article.querySelectorAll('figcaption[data-brevess-figure-caption="true"]')];
      return {
        parsedCaptionBoundariesPass: captions.length > 0 && captions.every(caption =>
          normalize(caption.textContent).length > 10 && !caption.querySelector('p')),
        typographyPass: !hasRawTex && Boolean(article.querySelector('em,sup,sub,.pdf-inline-overline'))
      };
    }
    const listSelector = liveProbes.referenceListSelector || 'ol';
    const sequences = [...article.querySelectorAll(listSelector)].map(list =>
      [...list.querySelectorAll(':scope > li')].map((item, index) =>
        Number(item.getAttribute('value') || Number(list.getAttribute('start') || 1) + index))
    ).filter(values => values.length >= 3);
    const referenceOrdinalsIncrease = sequences.some(values => values.every(
      (value, index) => Number.isSafeInteger(value) && value > 0 &&
        (index === 0 || value > values[index - 1])
    ));
    const statisticProbe = normalize(liveProbes.figure7StatisticProbe);
    const captions = [...article.querySelectorAll('figcaption[data-brevess-figure-caption="true"]')];
    const figure7Caption = captions.find(caption => /\bfig(?:ure)?\.?\s*7\b/i.test(caption.textContent || ''));
    const paragraphs = [...article.querySelectorAll('p')];
    const figure7StatisticsNotDuplicatedAsBody = Boolean(
      statisticProbe && figure7Caption && normalize(figure7Caption.textContent).includes(statisticProbe) &&
      !paragraphs.some(paragraph => normalize(paragraph.textContent).includes(statisticProbe))
    );
    const d1D2SuperscriptsPreserved = ['D1', 'D2'].every(prefix =>
      [...article.querySelectorAll('sup')].some(node =>
        normalize(node.textContent) === '+' && normalize(node.parentElement?.textContent).includes(prefix)
      ));
    return {
      referenceOrdinalsIncrease,
      figure7StatisticsNotDuplicatedAsBody,
      italicsPreserved: Boolean(article.querySelector('em')),
      d1D2SuperscriptsPreserved,
      h2oSubscriptPreserved: [...article.querySelectorAll('sub')]
        .some(node => normalize(node.textContent) === '2'),
      overbarAndLegacyTexResolved: Boolean(article.querySelector('.pdf-inline-overline')) && !hasRawTex
    };
  }, { paperKey: paper.key, probes });
  return auditLayoutRegression(paper.key, observed);
}

async function inspectTargetedLayout(page, paper, originalInspection) {
  if (paper.key !== 'neuron-2026-dopamine-circuits' && !paper.key.startsWith('pmc')) {
    return { ok: true };
  }
  const requiredKeys = paper.key === 'neuron-2026-dopamine-circuits'
    ? ['reference-ordinal', 'figure7-statistics', 'italic', 'd1-superscript',
      'd2-superscript', 'h2o-subscript', 'overbar-legacy-tex']
    : ['caption-boundary', 'scientific-typography'];
  const configured = Array.isArray(paper.automation?.layoutTargets)
    ? paper.automation.layoutTargets : [];
  const targets = requiredKeys.map(key => {
    const target = configured.find(item => clean(item?.key, 100) === key);
    const marker = clean(target?.markerText, 300);
    const selector = clean(target?.selector, 300);
    const semantic = clean(target?.semantic, 80);
    const pageNumber = Number(target?.pageNumber);
    if (!target || marker.length < 2 || !selector || !semantic ||
        !Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      throw new Error(`PENDING_EXTERNAL_INPUT: layout target missing for ${paper.key}`);
    }
    return { key, marker, selector, semantic, pageNumber,
      markerSha256: crypto.createHash('sha256').update(marker).digest('hex') };
  });
  const observedTargets = [];
  for (const target of targets) {
    const matches = page.locator(target.selector).filter({ hasText: target.marker });
    const matchCount = await matches.count();
    if (matchCount !== 1) {
      throw new Error(`PENDING_EXTERNAL_INPUT: layout target ambiguous for ${paper.key}`);
    }
    await matches.scrollIntoViewIfNeeded();
    const live = await matches.evaluate((node, expected) => {
      const pageNode = node.closest('[data-pdf-page-number]');
      const rawPageNumber = String(pageNode?.dataset?.pdfPageNumber || '');
      const pageNumber = /^[1-9]\d*$/u.test(rawPageNumber) ? Number(rawPageNumber) : 0;
      const matchesSemantic = {
        'reference-ordinal': node.matches('li[value]'),
        'figure-caption': node.matches('figcaption,[data-brevess-figure-caption="true"]'),
        italic: node.matches('em') || Boolean(node.querySelector('em')),
        superscript: node.matches('sup') || Boolean(node.querySelector('sup')),
        subscript: node.matches('sub') || Boolean(node.querySelector('sub')),
        overbar: node.matches('.pdf-inline-overline') || Boolean(node.querySelector('.pdf-inline-overline')),
        'caption-boundary': node.matches('figcaption,[data-brevess-figure-caption="true"]'),
        typography: Boolean(node.matches('em,sup,sub,.pdf-inline-overline') ||
          node.querySelector('em,sup,sub,.pdf-inline-overline'))
      };
      return {
        targetVisible: Boolean(node.getClientRects().length),
        semanticVerified: matchesSemantic[expected.semantic] === true,
        pageNumber
      };
    }, target);
    observedTargets.push({
      key: target.key, pageNumber: live.pageNumber, markerSha256: target.markerSha256,
      semantic: target.semantic, targetVisible: live.targetVisible,
      semanticVerified: live.semanticVerified && live.pageNumber === target.pageNumber
    });
  }
  const expected = {
    paperKey: paper.key, pdfSha256: paper.sha256,
    targets: targets.map(({ key, pageNumber, markerSha256, semantic }) =>
      ({ key, pageNumber, markerSha256, semantic }))
  };
  return auditTargetedLayoutInspection(expected, { targets: observedTargets }, originalInspection);
}

async function runPaper(page, worker, extensionId, paper, outputDir, nativeInput, externalInput,
  providerContext) {
  const paperDir = path.join(outputDir, paper.key);
  fs.mkdirSync(paperDir, { recursive: true });
  const diagnostics = diagnosticsFor(page, worker);
  await page.goto(`chrome-extension://${extensionId}/pdf-reader.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#pdfLocalFile').setInputFiles(paper.pdfPath);
  await page.locator('.pdf-native-page:not(.pdf-native-page-placeholder) canvas').first()
    .waitFor({ state: 'visible', timeout: 30000 });
  const checks = Object.fromEntries(checkChecklist.map(name => [name, false]));
  checks.first_page_interactive = true;
  const evidence = [];
  const toolbarReadings = [];
  const display80 = await setExactScale(page, 0.8, '80%');
  evidence.push(await capture(page, paperDir, 'toolbar-80.png'));
  toolbarReadings.push({ filename: 'toolbar-80.png', requestedScale: 0.8, displayedValue: display80 });
  const width80 = await page.locator('.pdf-native-page').first().evaluate(node => node.getBoundingClientRect().width);
  const display100 = await setExactScale(page, 1, '100%');
  evidence.push(await capture(page, paperDir, 'toolbar-100.png'));
  toolbarReadings.push({ filename: 'toolbar-100.png', requestedScale: 1, displayedValue: display100 });
  const width100 = await page.locator('.pdf-native-page').first().evaluate(node => node.getBoundingClientRect().width);
  checks.zoom_changes_width = width80 !== width100;
  await page.locator('#pdfReaderZoomReset').click();
  evidence.push(await capture(page, paperDir, 'toolbar-fit-width.png'));
  const fit = await page.evaluate(() => {
    const pageNode = document.querySelector('.pdf-native-page');
    const container = document.querySelector('#pdfNativeViewer');
    if (!pageNode || !container) return false;
    return Math.abs(pageNode.getBoundingClientRect().width - container.clientWidth) <= 48;
  });
  const fitDimensions = await page.evaluate(() => ({
    pageWidth: document.querySelector('.pdf-native-page')?.getBoundingClientRect().width || 0,
    containerWidth: document.querySelector('#pdfNativeViewer')?.clientWidth || 0
  }));
  toolbarReadings.push({ filename: 'toolbar-fit-width.png', fitWidth: fit, ...fitDimensions });
  const toolbarAudit = auditToolbarCaptures(toolbarReadings);
  checks.zoom_changes_width = checks.zoom_changes_width && toolbarAudit.exact80 && toolbarAudit.exact100;
  checks.fit_width_matches_container = toolbarAudit.fitWidth;
  const toggle = page.locator('#pdfReaderViewToggle');
  if (await toggle.isVisible()) {
    const before = await toggle.getAttribute('aria-pressed');
    await toggle.click();
    await toggle.click();
    checks.toggle_round_trip = await toggle.getAttribute('aria-pressed') === before;
  }
  const selected = await selectNativeText(page);
  let qaAnswer = null;
  if (selected) {
    await page.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 5000 });
    const qa = providerContext?.selectionAction || {};
    const actionName = clean(qa.name, 120);
    const actionId = clean(qa.id, 120);
    const profileId = clean(providerContext?.probeReceipt?.profileId, 120);
    if (!actionName || !actionId || !profileId) {
      throw new Error(`PENDING_EXTERNAL_INPUT: grounded Q&A identity missing for ${paper.key}`);
    }
    const evidenceSha256 = crypto.createHash('sha256').update(selected.text).digest('hex');
    const selectionDocumentSha256 = crypto.createHash('sha256')
      .update(String(selected.documentHash || '')).digest('hex');
    const monitor = await page.context().newPage();
    await monitor.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await monitor.evaluate(() => {
      globalThis.__pdfQaChatEvents = [];
      chrome.runtime.onMessage.addListener(message => {
        if (message?.type === 'ARTICLE_CHAT_STATE_CHANGED' && message.event?.turn) {
          globalThis.__pdfQaChatEvents.push(message.event);
        }
      });
    });
    const preClick = await monitor.evaluate(async expectedDocumentHash => {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'getArticleWorkspaceSnapshot', chatLimit: 1000
          });
          const snapshot = response?.snapshot;
          const documentHash = String(snapshot?.documentHash || snapshot?.structure?.documentHash || '');
          if (response?.success && documentHash === expectedDocumentHash) {
            const chat = snapshot.chat || {};
            const turns = Array.isArray(chat.turns) ? chat.turns : [];
            const operationIds = [...new Set([
              chat.operationId, ...turns.map(turn => turn?.operationId),
              ...globalThis.__pdfQaChatEvents.map(event => event?.turn?.operationId)
            ].map(value => String(value || '')).filter(Boolean))];
            return { operationIds, profileInFlight: chat.loading === true || turns.some(turn =>
              ['queued', 'generating'].includes(turn?.status)), documentHash };
          }
        } catch { /* Tabs without the production content script are irrelevant. */ }
      }
      return null;
    }, String(selected.documentHash || ''));
    if (!preClick || preClick.profileInFlight) {
      await monitor.close();
      throw new Error('PDF_QA_PRECLICK_STATE_INVALID');
    }
    const qaActions = page.locator('#sci-manual-toolbar .sci-manual-llm-action')
      .filter({ hasText: actionName });
    if (await qaActions.count() !== 1) throw new Error('PDF_QA_ACTION_NOT_UNIQUE');
    preClick.operationIds = await monitor.evaluate(known => [...new Set([
      ...known, ...globalThis.__pdfQaChatEvents.map(event => event?.turn?.operationId)
    ].map(value => String(value || '')).filter(Boolean))], preClick.operationIds);
    const clickedAt = Date.now();
    paper.__qaSelection = {
      actionId, profileId, pageNumber: selected.pageNumber,
      sourceId: selected.sourceId, evidenceSha256, selectionDocumentSha256, clickedAt
    };
    await qaActions.click();
    const correlation = { profile: profileId, source: selected.sourceId, hash: evidenceSha256,
      clickedAt, baseline: preClick.operationIds };
    await monitor.waitForFunction(input => {
      const baseline = new Set(input.baseline);
      const started = globalThis.__pdfQaChatEvents.filter(event =>
        event?.phase === 'chat_started' && event.turn?.operationId &&
        !baseline.has(event.turn.operationId) && Number(event.turn.createdAt) >= input.clickedAt);
      const operationIds = [...new Set(started.map(event => event.turn.operationId))];
      if (operationIds.length > 1) return true;
      if (operationIds.length !== 1) return false;
      return globalThis.__pdfQaChatEvents.some(event => event?.phase === 'chat_completed' &&
        event.turn?.status === 'completed' && event.turn?.operationId === operationIds[0]);
    }, correlation, { timeout: 120000 });
    const responseState = await monitor.evaluate(input => {
      const baseline = new Set(input.baseline);
      const started = globalThis.__pdfQaChatEvents.filter(event =>
        event?.phase === 'chat_started' && event.turn?.operationId &&
        !baseline.has(event.turn.operationId) && Number(event.turn.createdAt) >= input.clickedAt);
      const operationIds = [...new Set(started.map(event => event.turn.operationId))];
      if (operationIds.length !== 1) return { error: 'PDF_QA_CONCURRENT_OPERATION' };
      const operationId = operationIds[0];
      const completed = globalThis.__pdfQaChatEvents.findLast(event =>
        event?.phase === 'chat_completed' && event.turn?.status === 'completed' &&
        event.turn?.operationId === operationId);
      if (!completed) return { error: 'PDF_QA_RESPONSE_TIMEOUT' };
      const turn = completed.turn;
      const evidenceMatches = (turn.answerBlocks || []).some(block => (block.evidence || [])
        .some(item => item.sourceKey === input.source && item.paragraphId === input.source &&
          item.textHash === input.hash));
      if (turn.selectedProfileId !== input.profile || Number(turn.createdAt) < input.clickedAt ||
          !evidenceMatches) return { error: 'PDF_QA_SELECTION_EVIDENCE_MISMATCH' };
      return { turn, startedAt: Number(started.find(event =>
        event.turn.operationId === operationId)?.turn?.createdAt) || 0,
      completedAt: Number(turn.updatedAt) || Date.now() };
    }, correlation);
    await monitor.close();
    if (responseState.error) throw new Error(responseState.error);
    const turn = responseState.turn;
    const citations = (turn?.answerBlocks || []).flatMap(block => block.evidence || [])
      .map(item => ({ pageNumber: selected.pageNumber, sourceId: item.sourceKey,
        evidenceSha256: item.textHash }));
    qaAnswer = {
      actionId, profileId: turn?.selectedProfileId,
      pageNumber: selected.pageNumber, sourceId: selected.sourceId, evidenceSha256,
      selectionDocumentSha256, operationId: turn?.operationId,
      startedAt: responseState.startedAt, completedAt: responseState.completedAt,
      answerText: (turn?.answerBlocks || []).map(block => block.markdown || '').join('\n'), citations
    };
  }
  const qaAudit = auditGroundedSelectionQa(paper.__qaSelection, qaAnswer);
  checks.selection_qa_grounded = qaAudit.ok;
  if (await selectNativeText(page)) {
    await page.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#sci-manual-toolbar .sci-manual-secondary-row button')
      .filter({ hasText: '高亮后写备注' }).click();
    const category = page.locator('#sci-manual-toolbar .sci-manual-category').first();
    if (await category.isVisible()) await category.click();
    const editor = page.locator('#sci-highlight-context-popover textarea');
    await editor.waitFor({ state: 'visible', timeout: 5000 });
    const qaNote = `Real-paper QA annotation note ${activeReport.runId}`;
    paper.__qaNote = qaNote;
    await editor.fill(qaNote);
    await page.locator('#sci-highlight-context-popover button').filter({ hasText: '保存修改' }).click();
  }
  const createdHit = page.locator(`.pdf-native-annotation-hit[title="${paper.__qaNote}"]`).first();
  await createdHit.waitFor({ state: 'visible', timeout: 10000 });
  const expectedAnnotation = await createdHit.evaluate(node => ({
    annotationId: node.dataset.annotationId || '',
    pageNumber: Number(node.closest('[data-pdf-page-number]')?.dataset?.pdfPageNumber) || 0
  }));
  expectedAnnotation.noteSha256 = crypto.createHash('sha256').update(paper.__qaNote).digest('hex');
  checks.selection_highlight_visible = Boolean(expectedAnnotation.annotationId && expectedAnnotation.pageNumber);
  evidence.push(await capture(page, paperDir, 'selection-before-zoom.png'));
  await page.locator('#pdfReaderZoomIn').click();
  evidence.push(await capture(page, paperDir, 'selection-after-zoom.png'));
  checks.selection_note_persisted = await createdHit.count() === 1;
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('#pdfReaderSaveAnnotated').click();
  const download = await downloadPromise;
  const annotatedPath = path.join(paperDir, 'annotated-copy.pdf');
  await download.saveAs(annotatedPath);
  const annotatedPdfSha256 = hashFile(annotatedPath);
  const annotatedPageCount = await pdfPageCount(annotatedPath);
  if (annotatedPageCount !== paper.pageCount) {
    throw new Error('PDF_ANNOTATED_COPY_PAGE_COUNT_MISMATCH');
  }
  const standardAnnotation = await inspectStandardAnnotation(
    annotatedPath, expectedAnnotation.pageNumber, expectedAnnotation.noteSha256
  );
  await page.locator('#pdfLocalFile').setInputFiles(annotatedPath);
  const reopenedHit = page.locator(
    `.pdf-native-annotation-hit[data-annotation-id="${expectedAnnotation.annotationId}"]`
  );
  await reopenedHit.first().waitFor({ state: 'visible', timeout: 30000 });
  const reopenedRecords = await page.locator('.pdf-native-annotation-hit').evaluateAll(nodes => nodes.map(node => ({
    annotationId: node.dataset.annotationId || '',
    pageNumber: Number(node.closest('[data-pdf-page-number]')?.dataset?.pdfPageNumber) || 0,
    note: node.getAttribute('title') || ''
  })));
  const normalizedReopenedRecords = reopenedRecords.map(record => ({ ...record,
    noteSha256: crypto.createHash('sha256').update(record.note).digest('hex') }));
  const overlayMatchCount = countExactAnnotationIdentity(normalizedReopenedRecords, expectedAnnotation);
  const reopened = normalizedReopenedRecords.find(record =>
    countExactAnnotationIdentity([record], expectedAnnotation) === 1) || {};
  reopened.overlayMatchCount = overlayMatchCount;
  reopened.standard = standardAnnotation;
  const reopenedAudit = auditReopenedAnnotation(expectedAnnotation, reopened);
  checks.saved_copy_reopens_with_annotation = reopenedAudit.ok;
  evidence.push(await capture(page, paperDir, 'reopened-annotated-copy.png'));
  const broadLayout = await inspectLiveLayout(page, paper);
  const targetedLayout = await inspectTargetedLayout(
    page, paper, nativeInput?.papers?.[paper.key]?.layoutOriginalInspection || {}
  );
  const layout = { ...broadLayout, ok: broadLayout.ok && targetedLayout.ok };
  evidence.push(await capture(page, paperDir, 'parsed-document.png'));
  if (await toggle.isVisible()) await toggle.click();
  evidence.push(await capture(page, paperDir, 'native-document.png'));
  let figureAudit = { ok: true, notApplicable: true };
  if (paper.key === 'neuron-2026-dopamine-circuits') {
    const figure = paper.automation?.figure7 || {};
    const figureId = clean(figure.figureId, 100);
    const pageNumber = Number(figure.pageNumber);
    const marker = clean(figure.markerText, 300);
    if (!/^[a-z0-9._:-]+$/iu.test(figureId) || !Number.isSafeInteger(pageNumber) ||
        pageNumber < 1 || marker.length < 8) {
      throw new Error('PENDING_EXTERNAL_INPUT: Figure 7 identity is incomplete');
    }
    const markerSha256 = crypto.createHash('sha256').update(marker).digest('hex');
    if (await toggle.isVisible()) await toggle.click();
    const parsedFigure = page.locator(`[data-figure-id="${figureId}"]`).filter({ hasText: marker }).first();
    await parsedFigure.scrollIntoViewIfNeeded();
    const parsedObservation = await parsedFigure.evaluate((node, expectedMarker) => {
      const text = String(node.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
      const rect = node.getBoundingClientRect();
      const markerOffset = text.indexOf(expectedMarker);
      return { targetVisible: Boolean(markerOffset >= 0 && rect.width > 0 && rect.height > 0),
        observedMarker: markerOffset >= 0 ? text.slice(markerOffset, markerOffset + expectedMarker.length) : '',
        targetRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }, marker);
    evidence.push(await capture(page, paperDir, 'figure7-parsed.png'));
    if (await toggle.isVisible()) await toggle.click();
    await page.evaluate(async targetPage => {
      await globalThis.__brevessPdfReaderBridge?.command?.('ensurePageIndexed', targetPage);
      return globalThis.__brevessPdfReaderBridge?.command?.('focusPage', targetPage);
    }, pageNumber);
    const nativeFigurePage = page.locator(`[data-pdf-page-number="${pageNumber}"]`).first();
    await nativeFigurePage.scrollIntoViewIfNeeded();
    const bounding = nativeInput?.papers?.[paper.key]?.layoutOriginalInspection
      ?.figure7BoundingMarker || {};
    if (![bounding.x, bounding.y, bounding.width, bounding.height]
      .every(value => Number.isFinite(Number(value))) || Number(bounding.width) <= 0 ||
        Number(bounding.height) <= 0 || Number(bounding.x) < 0 || Number(bounding.y) < 0 ||
        Number(bounding.x) + Number(bounding.width) > 1 ||
        Number(bounding.y) + Number(bounding.height) > 1) {
      throw new Error('PENDING_EXTERNAL_INPUT: Figure 7 native bounding marker is incomplete');
    }
    const nativeObservation = await nativeFigurePage.evaluate((node, input) => {
      const text = String(node.querySelector('.pdf-native-text-layer')?.textContent || '')
        .normalize('NFKC').replace(/\s+/g, ' ').trim();
      const pageRect = node.getBoundingClientRect();
      const markerOffset = text.indexOf(input.marker);
      const targetRect = { x: pageRect.x + Number(input.bounding.x) * pageRect.width,
        y: pageRect.y + Number(input.bounding.y) * pageRect.height,
        width: Number(input.bounding.width) * pageRect.width,
        height: Number(input.bounding.height) * pageRect.height };
      return { targetVisible: Boolean(markerOffset >= 0 && targetRect.width > 0 &&
          targetRect.height > 0 && targetRect.y < innerHeight && targetRect.y + targetRect.height > 0),
        observedMarker: markerOffset >= 0 ? text.slice(markerOffset, markerOffset + input.marker.length) : '',
        targetRect };
    }, { marker, bounding });
    evidence.push(await capture(page, paperDir, 'figure7-native.png'));
    figureAudit = auditFigureTargetCaptures(
      { figureId, pageNumber, markerSha256 },
      [
        { filename: 'figure7-parsed.png', mode: 'parsed', figureId, pageNumber,
          markerSha256, observedMarkerSha256: crypto.createHash('sha256')
            .update(parsedObservation.observedMarker).digest('hex'),
          targetVisible: parsedObservation.targetVisible, targetRect: parsedObservation.targetRect },
        { filename: 'figure7-native.png', mode: 'native', figureId, pageNumber,
          markerSha256, observedMarkerSha256: crypto.createHash('sha256')
            .update(nativeObservation.observedMarker).digest('hex'),
          targetVisible: nativeObservation.targetVisible, targetRect: nativeObservation.targetRect }
      ]
    );
    if (!figureAudit.ok) throw new Error('PDF_QA_FIGURE7_TARGET_MISMATCH');
  }
  const annotationIdentity = {
    annotationId: expectedAnnotation.annotationId,
    pageNumber: expectedAnnotation.pageNumber,
    noteSha256: expectedAnnotation.noteSha256,
    standard: standardAnnotation
  };
  const annotationIdentitySha256 = crypto.createHash('sha256')
    .update(JSON.stringify(annotationIdentity)).digest('hex');
  const binding = {
    paperKey: paper.key, sourcePdfSha256: paper.sha256,
    annotatedPdfSha256, pageCount: paper.pageCount,
    annotationCount: reopened.overlayMatchCount,
    annotationIdentitySha256
  };
  const externalInspection = auditExternalReaderInspection(
    externalInput?.papers?.[paper.key] || {}, binding
  );
  checks.independent_reopen_verified = reopenedAudit.ok;
  const runtimeAlive = await page.evaluate(() => Boolean(globalThis.chrome?.runtime?.id)).catch(() => false);
  if (!runtimeAlive) diagnostics.contextInvalidations += 1;
  const diagnosticsAudit = auditDiagnostics(diagnostics);
  checks.no_unhandled_error = diagnosticsAudit.ok;
  const checkAudit = auditPaperEvidence({ checks, unhandledErrors: diagnosticsAudit.count });
  const expectedScreenshots = paper.key === 'neuron-2026-dopamine-circuits'
    ? screenshotChecklist : screenshotChecklist.filter(name => !name.startsWith('figure7-'));
  const captured = evidence.filter(item => expectedScreenshots.includes(item.filename));
  const screenshots = {
    ok: captured.length === expectedScreenshots.length && captured.every(item => isHash(item.sha256)),
    evidence: captured
  };
  const nativeInspection = auditNativeInspection(
    nativeInput?.papers?.[paper.key] || {}, captured
  );
  const pass = process.env.HEADLESS === '0' && checkAudit.ok && layout.ok && screenshots.ok &&
    nativeInspection.ok && externalInspection.ok;
  return publicPaperResult({
    ...paper, checks: checkAudit, layout, screenshots, nativeInspection,
    externalReaderInspection: externalInspection,
    artifact: {
      sourcePdfSha256: paper.sha256, annotatedPdfSha256,
      annotationIdentitySha256, annotationCount: binding.annotationCount
    },
    receipt: {
      checksOk: checkAudit.ok, checks: checkAudit.checks,
      layoutOk: layout.ok, layout: layout.checks,
      diagnosticsOk: diagnosticsAudit.ok, diagnosticsCount: diagnosticsAudit.count,
      diagnostics: { pageErrors: diagnosticsAudit.pageErrors.length,
        consoleErrors: diagnosticsAudit.consoleErrors.length,
        workerErrors: diagnosticsAudit.workerErrors.length,
        pageCrashes: diagnosticsAudit.pageCrashes,
        contextInvalidations: diagnosticsAudit.contextInvalidations },
      toolbarOk: toolbarAudit.ok, toolbar: toolbarAudit,
      figureOk: figureAudit.ok, figure: figureAudit,
      qaOk: qaAudit.ok, qa: { ...qaAudit,
        operationId: qaAnswer?.operationId, clickedAt: paper.__qaSelection?.clickedAt,
        startedAt: qaAnswer?.startedAt, completedAt: qaAnswer?.completedAt,
        pageNumber: qaAnswer?.pageNumber, sourceId: qaAnswer?.sourceId,
        evidenceSha256: qaAnswer?.evidenceSha256,
        selectionDocumentSha256: qaAnswer?.selectionDocumentSha256 },
      standardAnnotationOk: Number(standardAnnotation?.matchCount) === 1 &&
        Number(standardAnnotation?.pageNumber) === Number(expectedAnnotation.pageNumber), standardAnnotation,
      independentReopenOk: reopenedAudit.ok, independentReopen: reopenedAudit
    },
    artifacts: {
      annotatedPdf: { relativePath: `${paper.key}/annotated-copy.pdf`,
        sha256: annotatedPdfSha256, size: fs.statSync(annotatedPath).size },
      screenshots: captured.map(item => ({ ...item, relativePath: `${paper.key}/${item.filename}` }))
    },
    diagnostics: { unhandledErrors: diagnosticsAudit.count }, pass
  });
}

export function safeRuntimeFailure(error) {
  const message = clean(error?.message || error, 300);
  return message.startsWith('PENDING_EXTERNAL_INPUT:')
    ? message : 'PDF_READER_REAL_PAPER_VERIFIER_FAILED';
}

async function auditExistingMain(args) {
  const outputDir = path.resolve(args.output || process.env.OUTPUT_DIR ||
    path.join(root, 'output', 'playwright', 'pdf-reader-real-papers-audit'));
  const capturePath = path.resolve(String(args.auditExisting || ''));
  if (capturePath === path.join(outputDir, 'qa-result.json')) {
    throw new Error('PENDING_EXTERNAL_INPUT: audit output must not overwrite capture report');
  }
  beginReport(outputDir);
  const captureFile = readPrivateJson(capturePath, 'capture report is missing');
  const capture = captureFile.value?.captureArtifact || captureFile.value;
  const captureAudit = auditExistingCapture(capture);
  const captureRoot = path.dirname(captureFile.path);
  const diskFailures = [];
  const resolveArtifact = relativePath => {
    const safe = String(relativePath || '').replaceAll('\\', '/');
    if (!safe || path.isAbsolute(safe) || safe.split('/').includes('..')) return '';
    const resolved = path.resolve(captureRoot, safe);
    return resolved.startsWith(`${captureRoot}${path.sep}`) ? resolved : '';
  };
  for (const paper of capture.papers || []) {
    const pdf = paper.artifacts?.annotatedPdf || {};
    const pdfPath = resolveArtifact(pdf.relativePath);
    if (!pdfPath || !fs.existsSync(pdfPath) || hashFile(pdfPath) !== pdf.sha256 ||
        fs.statSync(pdfPath).size !== Number(pdf.size)) diskFailures.push(`${paper.key}:annotated-pdf`);
    for (const screenshot of paper.artifacts?.screenshots || []) {
      const filename = resolveArtifact(screenshot.relativePath);
      if (!filename || !fs.existsSync(filename)) {
        diskFailures.push(`${paper.key}:${screenshot.filename}`);
        continue;
      }
      const actual = await pngEvidence(filename).catch(() => null);
      if (!actual || actual.sha256 !== screenshot.sha256 || actual.width !== screenshot.width ||
          actual.height !== screenshot.height || actual.size !== screenshot.size) {
        diskFailures.push(`${paper.key}:${screenshot.filename}`);
      }
    }
  }
  const nativeFile = readPrivateJson(
    clean(args.inspection || process.env.PDF_READER_NATIVE_INSPECTION, 4000),
    'native-resolution inspection file is missing'
  );
  const externalFile = readPrivateJson(
    clean(args.externalInspection || process.env.PDF_READER_EXTERNAL_INSPECTION, 4000),
    'independent PDF reader inspection file is missing'
  );
  const papers = capture.papers.map(artifact => {
    const nativeInspection = auditNativeInspection(
      nativeFile.value?.papers?.[artifact.key] || {}, artifact.screenshots
    );
    const externalReaderInspection = auditExternalReaderInspection(
      externalFile.value?.papers?.[artifact.key] || {}, { paperKey: artifact.key, ...artifact }
    );
    return {
      key: artifact.key, nativeInspection, externalReaderInspection,
      pass: captureAudit.ok && diskFailures.length === 0 &&
        nativeInspection.ok && externalReaderInspection.ok
    };
  });
  const report = {
    schemaVersion: 1, runId: activeReport.runId, generatedAt: activeReport.generatedAt,
    status: 'AUDITED_EXISTING', captureRunId: capture.captureRunId,
    captureArtifactSha256: capture.artifactSha256, browserLaunched: false,
    diskArtifactFailures: diskFailures.slice(0, 64), papers,
    pass: captureAudit.ok && diskFailures.length === 0 &&
      papers.length > 0 && papers.every(paper => paper.pass)
  };
  writeJsonAtomically(activeReport.filename, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) { console.log(helpText()); return; }
  if (args.auditExisting) return auditExistingMain(args);
  const outputDir = path.resolve(args.output || process.env.OUTPUT_DIR ||
    path.join(root, 'output', 'playwright', 'pdf-reader-real-papers'));
  beginReport(outputDir);
  const inputFilename = clean(args.input || process.env.PDF_READER_QA_INPUT, 4000);
  const privateInput = readPrivateJson(inputFilename, 'set --input or PDF_READER_QA_INPUT');
  const papers = await validateInput(privateInput.value);
  const profileId = clean(privateInput.value.profileId, 120);
  const selectionAction = privateInput.value.selectionAction || {};
  if (!profileId || !clean(selectionAction.id, 120) || !clean(selectionAction.name, 120)) {
    throw new Error('PENDING_EXTERNAL_INPUT: trusted profile id or selection action is missing');
  }
  const trustedProfileValue = clean(args.trustedProfile || process.env.PDF_READER_TRUSTED_PROFILE ||
    privateInput.value.trustedProfileDir, 4000);
  const extensionValue = clean(args.extension || process.env.EXTENSION_PATH, 4000);
  if (!extensionValue) throw new Error('PENDING_EXTERNAL_INPUT: set --extension or EXTENSION_PATH');
  const extensionPath = path.resolve(extensionValue);
  if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error('PENDING_EXTERNAL_INPUT: explicit unpacked extension is missing');
  }
  const extensionBuild = extensionBuildBinding(extensionPath);
  if (process.env.HEADLESS !== '0') {
    throw new Error('PENDING_EXTERNAL_INPUT: headed Edge requires HEADLESS=0');
  }
  const originalFilename = clean(
    args.originalInspection || process.env.PDF_READER_ORIGINAL_INSPECTION ||
      privateInput.value.originalInspectionPath, 4000
  );
  const originalInput = readPrivateJson(
    originalFilename, 'original-PDF layout inspection file is missing'
  ).value;
  const trustedProfile = snapshotTrustedProfile(trustedProfileValue);
  let context;
  let providerProbeReceipt = null;
  let controlPageDiagnostics = null;
  const results = [];
  try {
    const { chromium } = await import('playwright');
    context = await chromium.launchPersistentContext(trustedProfile.userDataDir, {
      channel: 'msedge', headless: false, viewport: { width: 1280, height: 1000 },
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    let workers = context.serviceWorkers();
    if (!workers.length) workers = [await context.waitForEvent('serviceworker')];
    const extensionId = new URL(workers[0].url()).host;
    const controlPage = await context.newPage();
    const operationId = crypto.randomUUID();
    const controlRun = await runWithControlPageDiagnostics(controlPage, async () => {
      await controlPage.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: 'domcontentloaded'
      });
      const sendFromControlPage = message => controlPage.evaluate(runtimeMessage =>
        new Promise((resolve, reject) => chrome.runtime.sendMessage(runtimeMessage, response => {
          const failure = chrome.runtime.lastError?.message;
          if (failure) reject(new Error(failure)); else resolve(response);
        })), message);
      return probeTrustedExistingProfile(sendFromControlPage, {
        profileId, providerId: clean(privateInput.value.providerId, 80),
        probeIds: privateInput.value.probeIds || ['structured_schema']
      });
    });
    const provisioned = controlRun.value;
    controlPageDiagnostics = {
      ok: controlRun.diagnostics.ok, count: controlRun.diagnostics.count,
      pageErrors: controlRun.diagnostics.pageErrors.length,
      consoleErrors: controlRun.diagnostics.consoleErrors.length,
      pageCrashes: controlRun.diagnostics.pageCrashes,
      contextInvalidations: controlRun.diagnostics.contextInvalidations
    };
    const probeReceipt = {
      profileFingerprintSha256: trustedProfile.sourceFingerprintSha256,
      profileId: clean(provisioned?.profileId, 120),
      providerId: clean(provisioned?.providerId, 80), ready: provisioned?.ready === true,
      operationId, checkedAt: new Date().toISOString()
    };
    providerProbeReceipt = probeReceipt;
    if (!auditProviderProbe({ profileFingerprintSha256: trustedProfile.sourceFingerprintSha256,
      profileId, providerId: provisioned.providerId
    }, probeReceipt).ok) throw new Error('PROVIDER_PROFILE_PROBE_NOT_READY');
    const providerContext = { probeReceipt, selectionAction };
    for (const paper of papers) {
      const page = await context.newPage();
      try { results.push(await runPaper(
        page, workers[0], extensionId, paper, outputDir, originalInput, {}, providerContext
      )); }
      finally { await page.close().catch(() => undefined); }
    }
  } finally {
    await context?.close().catch(() => undefined);
    trustedProfile.cleanup();
  }
  const report = {
    schemaVersion: 1, runId: activeReport.runId, generatedAt: activeReport.generatedAt,
    status: 'CAPTURED_PENDING_AUDIT', headedEdge: true,
    inputBinding: { schemaVersion: Number(privateInput.value.schemaVersion) || 0,
      sha256: hashFile(privateInput.path) },
    extensionBuild, providerProbe: providerProbeReceipt,
    globalReceipt: { ok: controlPageDiagnostics?.ok === true, controlPageDiagnostics },
    papers: results, pass: false
  };
  const captureArtifact = {
    captureRunId: report.runId, capturePass: false,
    providerProbeSha256: crypto.createHash('sha256')
      .update(JSON.stringify(providerProbeReceipt)).digest('hex'),
    extensionBuildSha256: extensionBuild.buildSha256,
    globalReceipt: report.globalReceipt,
    papers: results.map(result => ({
      key: result.key, sourcePdfSha256: result.artifact.sourcePdfSha256,
      annotatedPdfSha256: result.artifact.annotatedPdfSha256, pageCount: result.pageCount,
      annotationCount: result.artifact.annotationCount,
      annotationIdentitySha256: result.artifact.annotationIdentitySha256,
      screenshots: result.screenshots.evidence,
      receipt: result.receipt, artifacts: result.artifacts
    }))
  };
  report.captureArtifact = {
    ...captureArtifact, artifactSha256: buildCaptureArtifactHash(captureArtifact)
  };
  writeJsonAtomically(activeReport.filename, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch(error => {
    const failure = {
      schemaVersion: 1, runId: activeReport?.runId || crypto.randomUUID(),
      generatedAt: activeReport?.generatedAt || new Date().toISOString(),
      status: 'FAILED', papers: [], pass: false, error: safeRuntimeFailure(error)
    };
    if (activeReport?.filename) writeJsonAtomically(activeReport.filename, failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  });
}
