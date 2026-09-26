import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import panelLedgerCore from '../core/panel-ledger.js';

const root = path.resolve(import.meta.dirname, '..');
let activeReport = null;

function writeReportAtomically(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filename);
}

function beginReport(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  activeReport = {
    filename: path.join(outputDir, 'qa-result.json'),
    runId: crypto.randomUUID(), generatedAt: new Date().toISOString()
  };
  writeReportAtomically(activeReport.filename, {
    schemaVersion: 1, runId: activeReport.runId,
    generatedAt: activeReport.generatedAt, status: 'RUNNING', papers: [], pass: false
  });
}

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

export const editScenarioChecklist = Object.freeze([
  'rename_node', 'add_node', 'delete_node', 'create_branch',
  'create_feedback_cycle', 'add_evidence_to_empty_cell', 'change_panel_alias',
  'switch_evidence_classes', 'delete_evidence', 'reload', 'regenerate', 'export'
]);

export const screenshotChecklist = Object.freeze([
  'desktop-full-matrix-graph.png',
  'narrow-full-matrix-graph.png',
  'narrow-sticky-headers-scrolled.png',
  'narrow-empty-cell-editor.png',
  'desktop-populated-cell-editor.png',
  'narrow-long-alias-ellipsis.png',
  'desktop-bottom-legend.png',
  'desktop-cycle-feedback-graph.png',
  'narrow-reloaded-state.png'
]);

const dispositions = new Set(['linked', 'unlinked', 'excluded', 'ambiguous']);
const clean = (value, maximum = 500) => String(value ?? '')
  .normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maximum);
const identity = value => {
  if (typeof value === 'string' && value.includes('\u0000')) return value;
  if (typeof value === 'string' && value.includes(':')) {
    const separator = value.indexOf(':');
    return `${clean(value.slice(0, separator), 200)}\u0000${clean(
      value.slice(separator + 1), 100
    )}`;
  }
  const figureId = clean(value?.figureId, 200);
  const panelId = clean(value?.panelId, 100);
  if (figureId && panelId) return `${figureId}\u0000${panelId}`;
  const panelKey = clean(value?.panelKey, 300);
  return panelKey ? identity(panelKey) : '';
};
const dispositionOf = value => clean(
  value?.disposition ?? value?.status, 24
).toLowerCase();

export function auditPanelCoverage({
  ledger = [], originalPanels = [], tableChips = [], visibleDispositionKeys
} = {}) {
  const normalizedLedger = (Array.isArray(ledger) ? ledger : []).map(entry => ({
    key: identity(entry) || clean(entry?.panelKey, 300).replace(':', '\u0000'),
    disposition: dispositionOf(entry)
  })).filter(entry => entry.key);
  const ledgerKeys = new Set(normalizedLedger.map(entry => entry.key));
  const originalKeys = new Set((Array.isArray(originalPanels) ? originalPanels : [])
    .map(identity).filter(Boolean));
  const chipKeys = (Array.isArray(tableChips) ? tableChips : []).map(identity).filter(Boolean);
  const chipSet = new Set(chipKeys);
  const missingDispositions = normalizedLedger
    .filter(entry => !dispositions.has(entry.disposition)).map(entry => entry.key).sort();
  const missingFromLedger = [...originalKeys].filter(key => !ledgerKeys.has(key)).sort();
  const nonexistentLedgerPanels = [...ledgerKeys].filter(key => !originalKeys.has(key)).sort();
  const phantomTableChips = chipKeys.filter(key => !ledgerKeys.has(key) || !originalKeys.has(key))
    .filter((key, index, values) => values.indexOf(key) === index).sort();
  const linkedMissingFromTable = normalizedLedger
    .filter(entry => entry.disposition === 'linked' && !chipSet.has(entry.key))
    .map(entry => entry.key).sort();
  const nonLinkedPresentInTable = normalizedLedger
    .filter(entry => entry.disposition !== 'linked' &&
      dispositions.has(entry.disposition) && chipSet.has(entry.key))
    .map(entry => entry.key).sort();
  const visibleKeys = new Set((Array.isArray(visibleDispositionKeys)
    ? visibleDispositionKeys : []).map(identity).filter(Boolean));
  const nonLinkedMissingFromAuditUi = Array.isArray(visibleDispositionKeys)
    ? normalizedLedger.filter(entry => entry.disposition !== 'linked' &&
      dispositions.has(entry.disposition) && !visibleKeys.has(entry.key))
      .map(entry => entry.key).sort()
    : [];
  const counts = {
    discovered: originalKeys.size,
    linked: normalizedLedger.filter(entry => entry.disposition === 'linked').length,
    unlinked: normalizedLedger.filter(entry => entry.disposition === 'unlinked').length,
    excluded: normalizedLedger.filter(entry => entry.disposition === 'excluded').length,
    ambiguous: normalizedLedger.filter(entry => entry.disposition === 'ambiguous').length,
    tableChips: chipKeys.length
  };
  const duplicateLedgerKeys = normalizedLedger.map(entry => entry.key)
    .filter((key, index, values) => values.indexOf(key) !== index)
    .filter((key, index, values) => values.indexOf(key) === index).sort();
  const ok = originalKeys.size > 0 && normalizedLedger.length > 0 && [
    missingDispositions, missingFromLedger, nonexistentLedgerPanels,
    phantomTableChips, linkedMissingFromTable, nonLinkedPresentInTable, duplicateLedgerKeys,
    nonLinkedMissingFromAuditUi
  ].every(items => items.length === 0);
  return Object.freeze({
    ok, counts, missingDispositions, missingFromLedger, nonexistentLedgerPanels,
    phantomTableChips, linkedMissingFromTable, nonLinkedPresentInTable, duplicateLedgerKeys,
    nonLinkedMissingFromAuditUi
  });
}

export function auditOriginalPanelInspection(value = {}, bindings = null) {
  const bindingOk = !bindings || [
    'paperKey', 'pdfSha256', 'archiveSha256', 'panelManifestSha256'
  ].every(key => clean(value?.[key], 200).toLowerCase() ===
    clean(bindings?.[key], 200).toLowerCase());
  const ok = value?.status === 'PASS' && value?.originalArticleReviewed === true &&
    clean(value?.observation, 500).length > 0 && bindingOk;
  return Object.freeze({ ok, originalArticleReviewed: value?.originalArticleReviewed === true });
}

function titleTokens(value) {
  return clean(value, 1000).toLowerCase().match(/[a-z0-9]+/gu)
    ?.filter(token => token.length > 2) || [];
}

function titleMatches(expected, actual) {
  const expectedTokens = [...new Set(titleTokens(expected))];
  const actualTokens = new Set(titleTokens(actual));
  return expectedTokens.length >= 4 &&
    expectedTokens.filter(token => actualTokens.has(token)).length / expectedTokens.length >= 0.8;
}

export async function waitForMatchingArticleTitle(page, expectedTitle, {
  timeoutMs = 15000, pollMs = 150
} = {}) {
  const timeout = Math.max(1, Math.min(30000, Number(timeoutMs) || 15000));
  const poll = Math.max(1, Math.min(1000, Number(pollMs) || 150));
  const deadline = Date.now() + timeout;
  let title = await page.title();
  while (!titleMatches(expectedTitle, title) && Date.now() < deadline) {
    await page.waitForTimeout(Math.min(poll, Math.max(1, deadline - Date.now())));
    title = await page.title();
  }
  return Object.freeze({ title, matched: titleMatches(expectedTitle, title) });
}

export function auditPaperBindings(expected = {}, actual = {}) {
  const hashesMatch = ['pdfSha256', 'archiveSha256', 'panelManifestSha256']
    .every(key => /^[a-f0-9]{64}$/iu.test(String(actual?.[key] || '')) &&
      clean(expected?.[key === 'pdfSha256' ? 'sha256' : key], 64).toLowerCase() ===
      clean(actual?.[key], 64).toLowerCase());
  const pageCountMatches = Number.isSafeInteger(expected.pageCount) &&
    expected.pageCount > 0 && expected.pageCount === actual.pageCount;
  const archiveTitleMatches = titleMatches(expected.title, actual.archiveTitle);
  const liveArticleTitleMatches = titleMatches(expected.title, actual.liveArticleTitle);
  return Object.freeze({
    ok: hashesMatch && pageCountMatches && archiveTitleMatches && liveArticleTitleMatches,
    hashesMatch, pageCountMatches, archiveTitleMatches, liveArticleTitleMatches
  });
}

function panelManifestHash(originalPanels) {
  const keys = (Array.isArray(originalPanels) ? originalPanels : [])
    .map(identity).filter(Boolean).sort();
  return crypto.createHash('sha256').update(JSON.stringify(keys)).digest('hex');
}

export function auditNativeInspection(value = {}, screenshotEvidence = []) {
  const reviews = value?.screenshots && typeof value.screenshots === 'object'
    ? value.screenshots : {};
  const missing = [];
  const mismatched = [];
  for (const evidence of Array.isArray(screenshotEvidence) ? screenshotEvidence : []) {
    const filename = path.basename(clean(evidence?.filename, 200));
    const review = reviews[filename];
    if (review?.status !== 'PASS' || review?.nativeResolution !== true ||
        !clean(review?.observation, 300)) {
      missing.push(filename);
      continue;
    }
    if (clean(review.sha256, 64).toLowerCase() !== clean(evidence.sha256, 64).toLowerCase() ||
        Number(review.width) !== Number(evidence.width) ||
        Number(review.height) !== Number(evidence.height)) {
      mismatched.push(filename);
    }
  }
  return Object.freeze({
    ok: screenshotEvidence.length > 0 && !missing.length && !mismatched.length,
    reviewed: Math.max(0, screenshotEvidence.length - missing.length - mismatched.length),
    required: screenshotEvidence.length, missing, mismatched
  });
}

export function safeRuntimeFailure(error) {
  const message = clean(error?.message || error, 500);
  if (message.startsWith('PENDING_EXTERNAL_INPUT:')) return message;
  const allowed = new Set([
    'CANONICAL_PANEL_LEDGER_EMPTY', 'MECHANISM_AUDIT_UI_INCOMPLETE',
    'EDITABLE_MATRIX_SCENARIO_FAILED', 'EDITABLE_MATRIX_EXPORT_FAILED'
  ]);
  return allowed.has(message) ? message : 'EDITABLE_MATRIX_VERIFIER_FAILED';
}

function byteEqual(left, right) {
  return Buffer.from(String(left ?? ''), 'utf8').equals(Buffer.from(String(right ?? ''), 'utf8'));
}

export function auditGraphStability({
  before = {}, afterAlias = {}, afterClass = {}, forbiddenPanelNames = []
} = {}) {
  const byteExactAfterAlias = byteEqual(before.mermaid, afterAlias.mermaid) &&
    byteEqual(before.svg, afterAlias.svg);
  const byteExactAfterClass = byteEqual(before.mermaid, afterClass.mermaid) &&
    byteEqual(before.svg, afterClass.svg);
  const outputs = [before, afterAlias, afterClass].flatMap(state => [
    String(state?.mermaid ?? ''), String(state?.svg ?? '')
  ]);
  const structuralPatterns = [
    /(?:\bPanel\b|workspace-mechanism-(?:evidence|matrix)|\b(?:evidenceClass|panelEvidence)\b)/iu,
    /class=["'][^"']*\b(?:is-)?(?:sufficiency|necessity|other)\b/iu
  ];
  const panelNames = (Array.isArray(forbiddenPanelNames) ? forbiddenPanelNames : [])
    .map(name => clean(name, 200)).filter(Boolean);
  const visibleGraphText = (output, outputIndex) => {
    if (outputIndex % 2 === 0) {
      return [...output.matchAll(/\[([^\]]*)\]|\|([^|]*)\|/gu)]
        .map(match => match[1] ?? match[2] ?? '').join('\n');
    }
    return [...output.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/giu)]
      .map(match => match[1].replace(/<[^>]*>/gu, '')).join('\n');
  };
  const leaks = [];
  outputs.forEach((output, outputIndex) => structuralPatterns.forEach(pattern => {
    if (pattern.test(output)) leaks.push({ outputIndex, token: pattern.source.slice(0, 160) });
  }));
  outputs.forEach((output, outputIndex) => panelNames.forEach(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u');
    if (pattern.test(visibleGraphText(output, outputIndex))) {
      leaks.push({ outputIndex, token: escaped.slice(0, 160) });
    }
  }));
  const panelFree = leaks.length === 0;
  return Object.freeze({
    ok: byteExactAfterAlias && byteExactAfterClass && panelFree,
    byteExactAfterAlias, byteExactAfterClass, panelFree, leaks
  });
}

function regenerationShape(value = {}) {
  const nodes = (Array.isArray(value.nodes) ? value.nodes : []).map(node => ({
    id: clean(node?.id, 200), label: clean(node?.label?.value ?? node?.label, 500)
  })).sort((left, right) => left.id.localeCompare(right.id));
  const edges = (Array.isArray(value.edges) ? value.edges : []).map(edge => ({
    id: clean(edge?.id, 200), from: clean(edge?.from ?? edge?.sourceId, 200),
    to: clean(edge?.to ?? edge?.targetId, 200), polarity: clean(edge?.polarity, 40),
    panelEvidence: (Array.isArray(edge?.panelEvidence) ? edge.panelEvidence : []).map(item => ({
      figureId: clean(item?.figureId, 200), panelId: clean(item?.panelId, 100)
    })).sort((left, right) => `${left.figureId}\u0000${left.panelId}`
      .localeCompare(`${right.figureId}\u0000${right.panelId}`))
  })).sort((left, right) => left.id.localeCompare(right.id));
  return { nodes, edges };
}

export function auditRegeneration({ success = false, before = {}, generated = {}, after = {} } = {}) {
  const beforeShape = regenerationShape(before);
  const generatedShape = regenerationShape(generated);
  const afterShape = regenerationShape(after);
  const generatedMatches = generatedShape.nodes.every(expected =>
    afterShape.nodes.some(actual => actual.id === expected.id &&
      (actual.label === expected.label || beforeShape.nodes.some(previous =>
        previous.id === actual.id && previous.label === actual.label)))) &&
    generatedShape.edges.every(expected => afterShape.edges.some(actual =>
      actual.id === expected.id && actual.from === expected.from && actual.to === expected.to &&
      actual.polarity === expected.polarity && expected.panelEvidence.every(panel =>
        actual.panelEvidence.some(candidate => JSON.stringify(candidate) === JSON.stringify(panel)))));
  const semanticChange = JSON.stringify(beforeShape) !== JSON.stringify(afterShape);
  const revisionAdvanced = Number(after.revision) > Number(before.revision);
  return Object.freeze({
    ok: success === true && generatedShape.nodes.length > 0 && generatedMatches &&
      semanticChange && revisionAdvanced,
    generatedMatches, semanticChange, revisionAdvanced
  });
}

export function publicPaperResult(value = {}) {
  const coverage = value.coverage || {};
  const edits = value.edits || {};
  const exportsResult = value.exports || {};
  const screenshots = value.screenshots || {};
  const nativeInspection = value.nativeInspection || {};
  const boundedList = (items, maximum = 512) => (Array.isArray(items) ? items : [])
    .slice(0, maximum).map(item => clean(item, 300));
  return {
    key: clean(value.key, 100), title: clean(value.title, 500),
    doi: clean(value.doi, 160), pmid: clean(value.pmid, 40),
    sha256: /^[a-f0-9]{64}$/iu.test(String(value.sha256 || ''))
      ? String(value.sha256).toLowerCase() : '',
    pageCount: Number.isSafeInteger(value.pageCount) && value.pageCount > 0
      ? value.pageCount : 0,
    coverage: {
      ok: coverage.ok === true,
      ...(Object.hasOwn(coverage, 'originalArticleReviewed')
        ? { originalArticleReviewed: coverage.originalArticleReviewed === true } : {}),
      ...(coverage.counts ? { counts: Object.fromEntries(
        ['discovered', 'linked', 'unlinked', 'excluded', 'ambiguous', 'tableChips']
          .map(key => [key, Number(coverage.counts?.[key]) || 0])
      ) } : {}),
      ...Object.fromEntries([
        'missingDispositions', 'missingFromLedger', 'nonexistentLedgerPanels',
        'phantomTableChips', 'linkedMissingFromTable', 'nonLinkedPresentInTable',
        'duplicateLedgerKeys',
        'nonLinkedMissingFromAuditUi'
      ].filter(key => Array.isArray(coverage[key])).map(key => [key, boundedList(coverage[key])]))
    },
    edits: {
      ok: edits.ok === true,
      ...(edits.completed && typeof edits.completed === 'object'
        ? { completed: Object.fromEntries(editScenarioChecklist.map(name => [
          name, edits.completed?.[name] === true
        ])) } : {}),
      ...(edits.graph ? { graph: {
        ok: edits.graph.ok === true,
        byteExactAfterAlias: edits.graph.byteExactAfterAlias === true,
        byteExactAfterClass: edits.graph.byteExactAfterClass === true,
        panelFree: edits.graph.panelFree === true,
        leaks: (Array.isArray(edits.graph.leaks) ? edits.graph.leaks : [])
          .slice(0, 64).map(item => ({
            outputIndex: Number(item?.outputIndex) || 0,
            token: clean(item?.token, 160)
          }))
      } } : {})
    },
    exports: {
      ok: exportsResult.ok === true,
      jsonBytes: Math.max(0, Number(exportsResult.jsonBytes) || 0),
      svgBytes: Math.max(0, Number(exportsResult.svgBytes) || 0),
      pngBytes: Math.max(0, Number(exportsResult.pngBytes) || 0)
    },
    screenshots: {
      ok: screenshots.ok === true,
      count: Math.max(0, Number(screenshots.count) || 0),
      expected: Math.max(0, Number(screenshots.expected) || 0),
      files: boundedList(screenshots.files, screenshotChecklist.length)
        .map(filename => path.basename(filename)),
      evidence: (Array.isArray(screenshots.evidence) ? screenshots.evidence : [])
        .slice(0, screenshotChecklist.length).map(item => ({
          filename: path.basename(clean(item?.filename, 200)),
          sha256: /^[a-f0-9]{64}$/iu.test(String(item?.sha256 || ''))
            ? String(item.sha256).toLowerCase() : '',
          width: Math.max(0, Number(item?.width) || 0),
          height: Math.max(0, Number(item?.height) || 0)
        }))
    },
    nativeInspection: {
      ok: nativeInspection.ok === true,
      reviewed: Math.max(0, Number(nativeInspection.reviewed) || 0),
      required: Math.max(0, Number(nativeInspection.required) || 0),
      missing: boundedList(nativeInspection.missing, screenshotChecklist.length)
        .map(filename => path.basename(filename)),
      mismatched: boundedList(nativeInspection.mismatched, screenshotChecklist.length)
        .map(filename => path.basename(filename))
    },
    diagnostics: {
      unhandledErrors: Number(value.diagnostics?.unhandledErrors) || 0,
      consoleErrors: Number(value.diagnostics?.consoleErrors) || 0,
      publisherConsoleErrors: Number(value.diagnostics?.publisherConsoleErrors) || 0
    },
    pass: value.pass === true
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else if (argv[index] === '--extension') options.extension = argv[++index];
    else if (argv[index] === '--inspection') options.inspection = argv[++index];
    else if (argv[index] === '--help') options.help = true;
  }
  return options;
}

function helpText() {
  return [
    'Editable mechanism matrix real-paper verifier',
    'Usage: node scripts/verify-editable-mechanism-matrix.mjs --input <private-input.json>',
    '  --extension <unpacked-extension> [--output <artifact-dir>]',
    '  [--inspection <private-native-inspection.json>]',
    '',
    'The private input is read at runtime and is never copied to the report.',
    'Each paper needs key, title, articleUrl, archivePath, originalPanels, and PDF provenance.',
    'A run cannot PASS without headed Edge and native-resolution inspection records.'
  ].join('\n');
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
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

async function pdfPageCount(filename) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(fs.readFileSync(filename));
  const document = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
  try { return document.numPages; } finally { await document.destroy(); }
}

function locateExtension(explicit) {
  const requested = explicit || process.env.EXTENSION_PATH;
  return requested ? path.resolve(requested) : '';
}

function extensionBuildBinding(extensionPath) {
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
  const buildHash = crypto.createHash('sha256');
  files.forEach(filename => {
    buildHash.update(path.relative(extensionPath, filename).replaceAll('\\', '/'));
    buildHash.update('\u0000');
    buildHash.update(fs.readFileSync(filename));
    buildHash.update('\u0000');
  });
  return Object.freeze({
    name: clean(manifest.name, 160), version: clean(manifest.version, 80),
    manifestVersion: Number(manifest.manifest_version) || 0,
    manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
    buildSha256: buildHash.digest('hex')
  });
}

function validatePrivateInput(raw) {
  const papers = Array.isArray(raw?.papers) ? raw.papers : [];
  return requiredPapers.map(required => {
    const candidate = papers.find(item => item?.key === required.key);
    if (!candidate) throw new Error(`PENDING_EXTERNAL_INPUT: missing ${required.key}`);
    if (clean(candidate.title, 500) !== required.title) {
      throw new Error(`PENDING_EXTERNAL_INPUT: title mismatch for ${required.key}`);
    }
    const archiveInput = String(candidate.archivePath || '').trim();
    const pdfInput = String(candidate.pdfPath || candidate.zoteroAttachmentPath || '').trim();
    if (!archiveInput) {
      throw new Error(`PENDING_EXTERNAL_INPUT: archive missing for ${required.key}`);
    }
    if (!pdfInput) {
      throw new Error(`PENDING_EXTERNAL_INPUT: PDF missing for ${required.key}`);
    }
    const archivePath = path.resolve(archiveInput);
    const pdfPath = path.resolve(pdfInput);
    if (!fs.existsSync(archivePath)) {
      throw new Error(`PENDING_EXTERNAL_INPUT: archive missing for ${required.key}`);
    }
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PENDING_EXTERNAL_INPUT: PDF missing for ${required.key}`);
    }
    if (!candidate.articleUrl) {
      throw new Error(`PENDING_EXTERNAL_INPUT: articleUrl missing for ${required.key}`);
    }
    if (!Array.isArray(candidate.originalPanels) || !candidate.originalPanels.length) {
      throw new Error(`PENDING_EXTERNAL_INPUT: original Panel audit missing for ${required.key}`);
    }
    for (const field of ['sha256', 'archiveSha256', 'panelManifestSha256']) {
      if (!/^[a-f0-9]{64}$/iu.test(String(candidate[field] || ''))) {
        throw new Error(`PENDING_EXTERNAL_INPUT: ${field} missing for ${required.key}`);
      }
    }
    if (!Number.isSafeInteger(candidate.pageCount) || candidate.pageCount < 1) {
      throw new Error(`PENDING_EXTERNAL_INPUT: pageCount missing for ${required.key}`);
    }
    if (!clean(candidate.doi || candidate.pmid, 160)) {
      throw new Error(`PENDING_EXTERNAL_INPUT: DOI or PMID missing for ${required.key}`);
    }
    if (!auditOriginalPanelInspection(candidate.originalPanelInspection).ok) {
      throw new Error(
        `PENDING_EXTERNAL_INPUT: original-article Panel inspection missing for ${required.key}`
      );
    }
    return { ...candidate, archivePath, pdfPath };
  });
}

function diagnosticsFor(page, { strictConsole = true } = {}) {
  const state = { unhandledErrors: [], consoleErrors: [], observedConsoleErrors: [] };
  page.on('pageerror', error => state.unhandledErrors.push(clean(error?.message, 300)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const target = strictConsole ? state.consoleErrors : state.observedConsoleErrors;
    target.push(clean(message.text(), 300));
  });
  return state;
}

function diagnosticsForWorker(worker) {
  const state = { unhandledErrors: [], consoleErrors: [] };
  const onConsole = message => {
    if (message.type() === 'error') state.consoleErrors.push(clean(message.text(), 300));
  };
  worker.on('console', onConsole);
  state.dispose = () => worker.off('console', onConsole);
  return state;
}

async function extensionWorker(context) {
  return context.serviceWorkers()[0] ||
    context.waitForEvent('serviceworker', { timeout: 20000 });
}

export async function liveExtensionWorker(context, extensionId) {
  const matches = worker => !extensionId || new URL(worker.url()).host === extensionId;
  const live = context.serviceWorkers().find(matches);
  if (live) return live;
  const wakePage = await context.newPage();
  const pending = context.waitForEvent('serviceworker', {
    predicate: matches, timeout: 20000
  }).catch(() => null);
  try {
    await wakePage.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    const started = context.serviceWorkers().find(matches) || await pending;
    if (!started) throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
    return started;
  } finally {
    await wakePage.close().catch(() => undefined);
  }
}

async function activateArticle(worker, articlePage) {
  const url = articlePage.url();
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const tab = tabs.find(item => item.url === url);
  if (!tab?.id) throw new Error('Unable to resolve the real-paper tab');
  await worker.evaluate(async current => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, current);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  }, tab);
  return tab;
}

export async function prepareLiveArticleIdentity(worker, tab, {
  timeoutMs = 15000, pollMs = 200,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay))
} = {}) {
  const timeout = Math.max(1, Math.min(30000, Number(timeoutMs) || 15000));
  const poll = Math.max(1, Math.min(1000, Number(pollMs) || 200));
  const deadline = Date.now() + timeout;
  const target = {
    id: Number(tab?.id) || 0,
    url: clean(tab?.url || tab?.pendingUrl, 2000)
  };
  let state = { ready: false, stale: false, documentId: '' };
  do {
    state = await worker.evaluate(async expected => {
      const normalize = value => SciLLM.normalizeTabDocumentUrl(value || '');
      const before = await chrome.tabs.get(expected.id).catch(() => null);
      if (!before || normalize(before.url || before.pendingUrl) !== normalize(expected.url)) {
        return { ready: false, stale: true, documentId: '' };
      }
      const firstPrepared = await chrome.tabs.sendMessage(expected.id, {
        action: 'prepareManualAnnotations'
      }).catch(() => null);
      const middle = await chrome.tabs.get(expected.id).catch(() => null);
      if (!middle || normalize(middle.url || middle.pendingUrl) !== normalize(expected.url)) {
        return { ready: false, stale: true, documentId: '' };
      }
      const secondPrepared = await chrome.tabs.sendMessage(expected.id, {
        action: 'prepareManualAnnotations'
      }).catch(() => null);
      const after = await chrome.tabs.get(expected.id).catch(() => null);
      if (!after || normalize(after.url || after.pendingUrl) !== normalize(expected.url)) {
        return { ready: false, stale: true, documentId: '' };
      }
      const normalizeProof = prepared => ({
        documentId: String(prepared?.documentId || ''),
        documentHash: String(prepared?.documentHash || ''),
        canonicalUrl: String(prepared?.canonicalUrl || ''),
        contentWorldNonce: String(prepared?.contentWorldNonce || ''),
        documentEpoch: Number(prepared?.documentEpoch) || 0,
        title: String(prepared?.title || '')
      });
      const sameLiveArticleIdentityProof = (left, right) => Boolean(left && right &&
        left.documentId && left.documentId === right.documentId &&
        left.documentHash && left.documentHash === right.documentHash &&
        left.canonicalUrl && left.canonicalUrl === right.canonicalUrl &&
        /^[a-f0-9]{32,64}$/u.test(left.contentWorldNonce) &&
        left.contentWorldNonce === right.contentWorldNonce &&
        Number.isSafeInteger(left.documentEpoch) && left.documentEpoch > 0 &&
        left.documentEpoch === right.documentEpoch);
      const firstProof = normalizeProof(firstPrepared);
      const secondProof = normalizeProof(secondPrepared);
      if (firstPrepared?.success === true && secondPrepared?.success === true &&
          !sameLiveArticleIdentityProof(firstProof, secondProof)) {
        return { ready: false, stale: true, documentId: '' };
      }
      return {
        ...secondProof,
        ready: firstPrepared?.success === true && secondPrepared?.success === true &&
          sameLiveArticleIdentityProof(firstProof, secondProof),
        stale: false
      };
    }, target);
    if (state.ready || state.stale || Date.now() >= deadline) return state;
    await wait(Math.min(poll, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  return state;
}

export function sameLiveArticleIdentity(left, right) {
  return Boolean(left && right &&
    String(left.documentId || '') &&
    String(left.documentId || '') === String(right.documentId || '') &&
    String(left.documentHash || '') &&
    String(left.documentHash || '') === String(right.documentHash || '') &&
    String(left.canonicalUrl || '') &&
    String(left.canonicalUrl || '') === String(right.canonicalUrl || '') &&
    /^[a-f0-9]{32,64}$/u.test(String(left.contentWorldNonce || '')) &&
    String(left.contentWorldNonce || '') === String(right.contentWorldNonce || '') &&
    Number.isSafeInteger(Number(left.documentEpoch)) && Number(left.documentEpoch) > 0 &&
    Number(left.documentEpoch) === Number(right.documentEpoch));
}

export function postCommitLiveArticleIdentity(applied, frozenIdentity) {
  const proof = applied?.manualExecutionProof;
  const diagnostics = safePostCommitProofDiagnostics(applied, frozenIdentity);
  if (!diagnostics.success || !diagnostics.proofPresent ||
      !diagnostics.documentIdMatch || !diagnostics.documentHashMatch ||
      !diagnostics.canonicalUrlMatch || !diagnostics.contentWorldNonceMatch ||
      !diagnostics.documentEpochAdvanced) return null;
  return { ...proof, ready: true, stale: false };
}

export function safePostCommitProofDiagnostics(applied, frozenIdentity) {
  const proof = applied?.manualExecutionProof;
  const status = String(applied?.postCommitStatus || '');
  return {
    success: applied?.success === true,
    committed: applied?.committed === true,
    retryable: applied?.retryable === true,
    postCommitStatus: /^[a-z0-9-]{1,80}$/u.test(status) ? status : 'invalid',
    proofPresent: Boolean(proof),
    documentIdMatch: Boolean(proof && frozenIdentity &&
      String(proof.documentId || '') === String(frozenIdentity.documentId || '')),
    documentHashMatch: Boolean(proof && frozenIdentity &&
      String(proof.documentHash || '') === String(frozenIdentity.documentHash || '')),
    canonicalUrlMatch: Boolean(proof && frozenIdentity &&
      String(proof.canonicalUrl || '') === String(frozenIdentity.canonicalUrl || '')),
    contentWorldNonceMatch: Boolean(proof && frozenIdentity &&
      /^[a-f0-9]{32,64}$/u.test(String(proof.contentWorldNonce || '')) &&
      String(proof.contentWorldNonce || '') ===
        String(frozenIdentity.contentWorldNonce || '')),
    documentEpochAdvanced: Boolean(proof && frozenIdentity &&
      Number.isSafeInteger(Number(proof.documentEpoch)) &&
      Number(proof.documentEpoch) > Number(frozenIdentity.documentEpoch))
  };
}

export function safeFigureWorkspacePersistenceProbe(result) {
  const candidate = String(result?.code || '');
  return {
    success: result?.success === true,
    code: /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidate)
      ? candidate : 'FIGURE_WORKSPACE_PROBE_INVALID_CODE'
  };
}

export function safePostCommitProofDiagnosticsFromError(error) {
  const marker = 'EDITABLE_MATRIX_POPUP_POST_COMMIT_IDENTITY_MISMATCH:';
  const message = String(error?.message || error);
  const markerIndex = message.indexOf(marker);
  if (markerIndex < 0) return null;
  const match = message.slice(markerIndex + marker.length).match(/^\{[^}\r\n]*\}/u);
  if (!match) return null;
  try {
    const candidate = JSON.parse(match[0]);
    const status = String(candidate?.postCommitStatus || '');
    const normalized = {
      success: candidate?.success === true,
      committed: candidate?.committed === true,
      retryable: candidate?.retryable === true,
      postCommitStatus: /^[a-z0-9-]{1,80}$/u.test(status) ? status : 'invalid',
      proofPresent: candidate?.proofPresent === true,
      documentIdMatch: candidate?.documentIdMatch === true,
      documentHashMatch: candidate?.documentHashMatch === true,
      canonicalUrlMatch: candidate?.canonicalUrlMatch === true,
      contentWorldNonceMatch: candidate?.contentWorldNonceMatch === true,
      documentEpochAdvanced: candidate?.documentEpochAdvanced === true
    };
    if (Object.hasOwn(candidate || {}, 'persistenceProbeSuccess') ||
        Object.hasOwn(candidate || {}, 'persistenceProbeCode')) {
      const probeCode = String(candidate?.persistenceProbeCode || '');
      normalized.persistenceProbeSuccess = candidate?.persistenceProbeSuccess === true;
      normalized.persistenceProbeCode = /^[A-Z][A-Z0-9_]{0,99}$/u.test(probeCode)
        ? probeCode : 'FIGURE_WORKSPACE_PROBE_INVALID_CODE';
    }
    return normalized;
  } catch (_) {
    return null;
  }
}

export async function applyArchiveRestoreTransaction({
  prepare, verifyTab, commit, expectedIdentity = null, attempts = 3,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay))
} = {}) {
  if (typeof prepare !== 'function' || typeof verifyTab !== 'function' ||
      typeof commit !== 'function') throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  const limit = Math.max(1, Math.min(5, Number(attempts) || 3));
  let mismatch = null;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    const identity = await prepare();
    if (!identity?.ready || identity.stale ||
        (expectedIdentity && !sameLiveArticleIdentity(identity, expectedIdentity))) {
      const error = new Error('PENDING_EXTERNAL_INPUT: live article identity changed');
      error.qaStage = !identity?.ready ? 'identity_prepare_unavailable'
        : identity.stale ? 'identity_prepare_stale' : 'identity_prepare_changed';
      throw error;
    }
    if (!await verifyTab(identity)) {
      const error = new Error('PENDING_EXTERNAL_INPUT: live article tab changed');
      error.qaStage = 'identity_tab_verify';
      throw error;
    }
    try {
      const result = await commit(identity);
      return { result, identity, attempts: attempt };
    } catch (error) {
      const code = String(error?.message || error);
      if (![
        'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH',
        'EDITABLE_MATRIX_POPUP_IDENTITY_RACE',
        'EDITABLE_MATRIX_POPUP_IDENTITY_MISMATCH'
      ].includes(code)) {
        throw error;
      }
      mismatch = error;
      if (attempt < limit) await wait(Math.min(1500, attempt * 750));
    }
  }
  throw mismatch || new Error('ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
}

async function openPanel(context, worker, extensionId, tab, archive) {
  const page = await context.newPage();
  const diagnostics = diagnosticsFor(page);
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await worker.evaluate(async tabId => {
    const activated = await chrome.tabs.update(tabId, { active: true });
    if (Number.isInteger(activated?.windowId)) {
      await chrome.windows.update(activated.windowId, { focused: true });
    }
  }, tab.id);
  await page.waitForFunction(tabId =>
    Number(activePanelTabContext?.tabId) === Number(tabId) &&
    activePanelTabContext?.activated === true &&
    Number(manualAnnotationState?.tabId) === Number(tabId) &&
    Boolean(manualAnnotationState?.documentId) &&
    Boolean(currentWorkspaceSnapshot),
  tab.id, { timeout: 30000 });
  await page.evaluate(async tabId => {
    const liveTab = await chrome.tabs.get(tabId);
    tabContextRequestSequence += 1;
    tabContextSequence += 1;
    activePanelTabContext = {
      tabId: liveTab.id,
      url: SciLLM.normalizeTabDocumentUrl(liveTab.url || liveTab.pendingUrl),
      key: panelTabDocumentKey(liveTab), activated: true, pdfMode: false,
      tabContextSequence
    };
    resetPanelArticleState();
    await initializeCurrentArticle();
  }, tab.id);
  const transaction = await applyArchiveRestoreTransaction({
    attempts: 5,
    prepare: () => prepareLiveArticleIdentity(worker, tab),
    verifyTab: identity => worker.evaluate(async expected => {
      const liveTab = await chrome.tabs.get(expected.id).catch(() => null);
      return Boolean(liveTab && SciLLM.normalizeTabDocumentUrl(
        liveTab.url || liveTab.pendingUrl
      ) === SciLLM.normalizeTabDocumentUrl(expected.url));
    }, { id: tab.id, url: tab.url, identity }),
    commit: identity => page.evaluate(async ({ tabId, archiveValue, identity, expected }) => {
      const firstLiveTab = await chrome.tabs.get(expected.id).catch(() => null);
      if (!firstLiveTab || SciLLM.normalizeTabDocumentUrl(
        firstLiveTab.url || firstLiveTab.pendingUrl
      ) !== SciLLM.normalizeTabDocumentUrl(expected.url)) {
        throw new Error('PENDING_EXTERNAL_INPUT: EDITABLE_MATRIX_COMMIT_TAB_CHANGED_BEFORE_REFRESH');
      }
      const refreshedIdentity = await refreshManualAnnotationSummary(tabId);
      const sameLiveArticleIdentity = (left, right) => Boolean(left && right &&
        String(left.documentId || '') && left.documentId === right.documentId &&
        String(left.documentHash || '') && left.documentHash === right.documentHash &&
        String(left.canonicalUrl || '') && left.canonicalUrl === right.canonicalUrl &&
        /^[a-f0-9]{32,64}$/u.test(String(left.contentWorldNonce || '')) &&
        left.contentWorldNonce === right.contentWorldNonce &&
        Number.isSafeInteger(Number(left.documentEpoch)) && Number(left.documentEpoch) > 0 &&
        Number(left.documentEpoch) === Number(right.documentEpoch));
      if (!refreshedIdentity) {
        const directIdentity = await sendTabMessage(tabId, {
          action: 'prepareManualAnnotations'
        }).catch(() => null);
        const currentTarget = await queryPanelTargetTab().catch(() => null);
        if (Number(currentTarget?.id) !== Number(tabId)) {
          throw new Error('EDITABLE_MATRIX_POPUP_TARGET_TAB_MISMATCH');
        }
        if (!directIdentity?.success || !directIdentity.documentId) {
          throw new Error('EDITABLE_MATRIX_POPUP_DIRECT_IDENTITY_UNAVAILABLE');
        }
        if (sameLiveArticleIdentity(directIdentity, identity)) {
          throw new Error('EDITABLE_MATRIX_POPUP_IDENTITY_RACE');
        }
        throw new Error('EDITABLE_MATRIX_POPUP_DIRECT_IDENTITY_MISMATCH');
      }
      if (!sameLiveArticleIdentity(refreshedIdentity, identity)) {
        throw new Error('EDITABLE_MATRIX_POPUP_IDENTITY_MISMATCH');
      }
      const liveTab = await chrome.tabs.get(expected.id).catch(() => null);
      if (!liveTab || SciLLM.normalizeTabDocumentUrl(liveTab.url || liveTab.pendingUrl) !==
          SciLLM.normalizeTabDocumentUrl(expected.url)) {
        throw new Error('PENDING_EXTERNAL_INPUT: EDITABLE_MATRIX_COMMIT_TAB_CHANGED_AFTER_REFRESH');
      }
      tabContextRequestSequence += 1;
      tabContextSequence += 1;
      activePanelTabContext = {
        tabId: liveTab.id,
        url: SciLLM.normalizeTabDocumentUrl(liveTab.url || liveTab.pendingUrl),
        key: panelTabDocumentKey(liveTab), activated: true, pdfMode: false,
        tabContextSequence
      };
      if (!applyManualAnnotationStateEvent(identity, tabId)) {
        throw new Error('PENDING_EXTERNAL_INPUT: EDITABLE_MATRIX_COMMIT_IDENTITY_REBIND_FAILED');
      }
      const applied = await applyLoadedArticleArchive(
        SciLLM.validateArticleArchive(archiveValue), {
        imported: true
      });
      const afterCommitTab = await chrome.tabs.get(expected.id).catch(() => null);
      if (!afterCommitTab || SciLLM.normalizeTabDocumentUrl(
        afterCommitTab.url || afterCommitTab.pendingUrl
      ) !== SciLLM.normalizeTabDocumentUrl(expected.url)) {
        throw new Error('PENDING_EXTERNAL_INPUT: EDITABLE_MATRIX_COMMIT_TAB_CHANGED_AFTER_APPLY');
      }
      const postCommitLiveArticleIdentity = (result, frozenIdentity) => {
        const proof = result?.manualExecutionProof;
        if (result?.success !== true || !proof ||
            String(proof.documentId || '') !== String(frozenIdentity.documentId || '') ||
            String(proof.documentHash || '') !== String(frozenIdentity.documentHash || '') ||
            String(proof.canonicalUrl || '') !== String(frozenIdentity.canonicalUrl || '') ||
            !/^[a-f0-9]{32,64}$/u.test(String(proof.contentWorldNonce || '')) ||
            String(proof.contentWorldNonce || '') !==
              String(frozenIdentity.contentWorldNonce || '') ||
            !Number.isSafeInteger(Number(proof.documentEpoch)) ||
            Number(proof.documentEpoch) <= Number(frozenIdentity.documentEpoch)) return null;
        return { ...proof, ready: true, stale: false };
      };
      const postCommitIdentity = postCommitLiveArticleIdentity(applied, identity);
      if (!postCommitIdentity) {
        const status = String(applied?.postCommitStatus || '');
        const proof = applied?.manualExecutionProof;
        const safeDiagnostics = {
          success: applied?.success === true,
          committed: applied?.committed === true,
          retryable: applied?.retryable === true,
          postCommitStatus: /^[a-z0-9-]{1,80}$/u.test(status) ? status : 'invalid',
          proofPresent: Boolean(proof),
          documentIdMatch: Boolean(proof &&
            String(proof.documentId || '') === String(identity.documentId || '')),
          documentHashMatch: Boolean(proof &&
            String(proof.documentHash || '') === String(identity.documentHash || '')),
          canonicalUrlMatch: Boolean(proof &&
            String(proof.canonicalUrl || '') === String(identity.canonicalUrl || '')),
          contentWorldNonceMatch: Boolean(proof &&
            /^[a-f0-9]{32,64}$/u.test(String(proof.contentWorldNonce || '')) &&
            String(proof.contentWorldNonce || '') === String(identity.contentWorldNonce || '')),
          documentEpochAdvanced: Boolean(proof &&
            Number.isSafeInteger(Number(proof.documentEpoch)) &&
            Number(proof.documentEpoch) > Number(identity.documentEpoch))
        };
        try {
          const probeContext = captureFigureWorkspaceEditContext();
          const probeResponse = await sendTabMessage(tabId, {
            action: 'flushFigureWorkspaceDraft',
            workspaceTarget: buildFigureWorkspaceEditTarget(probeContext)
          });
          const probeCode = String(probeResponse?.code || '');
          safeDiagnostics.persistenceProbeSuccess = probeResponse?.success === true;
          safeDiagnostics.persistenceProbeCode = /^[A-Z][A-Z0-9_]{0,99}$/u.test(probeCode)
            ? probeCode : 'FIGURE_WORKSPACE_PROBE_INVALID_CODE';
        } catch (probeError) {
          const probeCode = String(probeError?.code || '');
          safeDiagnostics.persistenceProbeSuccess = false;
          safeDiagnostics.persistenceProbeCode = /^[A-Z][A-Z0-9_]{0,99}$/u.test(probeCode)
            ? probeCode : 'FIGURE_WORKSPACE_PROBE_EXCEPTION';
        }
        throw new Error(
          `EDITABLE_MATRIX_POPUP_POST_COMMIT_IDENTITY_MISMATCH:` +
          JSON.stringify(safeDiagnostics)
        );
      }
      switchWorkspaceView('mechanism', { persist: false });
      renderMechanismChainWorkspace(currentWorkspaceSnapshot);
      return postCommitIdentity;
    }, {
      tabId: tab.id, archiveValue: archive, identity,
      expected: { id: tab.id, url: tab.url }
    })
  });
  const preparedIdentity = transaction.result;
  await page.waitForFunction(() =>
    document.querySelector('.workspace-mechanism-matrix') &&
    document.querySelector('.workspace-mechanism-mermaid svg'), null, { timeout: 30000 });
  return { page, diagnostics, preparedIdentity };
}

async function rebindPanelAfterReload(page, worker, articleTab, expectedIdentity) {
  await worker.evaluate(async tabId => {
    const activated = await chrome.tabs.update(tabId, { active: true });
    if (Number.isInteger(activated?.windowId)) {
      await chrome.windows.update(activated.windowId, { focused: true });
    }
  }, articleTab.id);
  await applyArchiveRestoreTransaction({
    expectedIdentity,
    prepare: () => prepareLiveArticleIdentity(worker, articleTab),
    verifyTab: identity => worker.evaluate(async expected => {
      const liveTab = await chrome.tabs.get(expected.id).catch(() => null);
      return Boolean(liveTab && SciLLM.normalizeTabDocumentUrl(
        liveTab.url || liveTab.pendingUrl
      ) === SciLLM.normalizeTabDocumentUrl(expected.url));
    }, { id: articleTab.id, url: articleTab.url, identity }),
    commit: async liveIdentity => {
      const contentStateReady = await worker.evaluate(async tabId => {
        const response = await chrome.tabs.sendMessage(tabId, {
          action: 'getArticleWorkspaceSnapshot', forceRefresh: false
        }).catch(() => null);
        const nodes = response?.snapshot?.figures?.draft?.mechanismChain?.nodes;
        return response?.success === true && Array.isArray(nodes) && nodes.length > 0;
      }, articleTab.id);
      if (!contentStateReady) {
        throw new Error('EDITABLE_MATRIX_CONTENT_CHAIN_EMPTY_BEFORE_POPUP_REBIND');
      }
      return page.evaluate(async ({ tabId, liveIdentity, expected }) => {
    const before = await chrome.tabs.get(expected.id).catch(() => null);
    if (!before || SciLLM.normalizeTabDocumentUrl(before.url || before.pendingUrl) !==
        SciLLM.normalizeTabDocumentUrl(expected.url)) {
      throw new Error('PENDING_EXTERNAL_INPUT: live article tab changed');
    }
    const liveTab = await chrome.tabs.get(tabId);
    tabContextRequestSequence += 1;
    tabContextSequence += 1;
    activePanelTabContext = {
      tabId: liveTab.id,
      url: SciLLM.normalizeTabDocumentUrl(liveTab.url || liveTab.pendingUrl),
      key: panelTabDocumentKey(liveTab), activated: true, pdfMode: false,
      tabContextSequence
    };
    resetPanelArticleState();
    await initializeCurrentArticle();
    const refreshedIdentity = await refreshManualAnnotationSummary(tabId);
    const exact = refreshedIdentity && liveIdentity &&
      refreshedIdentity.documentId === liveIdentity.documentId &&
      refreshedIdentity.documentHash === liveIdentity.documentHash &&
      refreshedIdentity.canonicalUrl === liveIdentity.canonicalUrl &&
      /^[a-f0-9]{32,64}$/u.test(String(refreshedIdentity.contentWorldNonce || '')) &&
      refreshedIdentity.contentWorldNonce === liveIdentity.contentWorldNonce &&
      Number.isSafeInteger(Number(refreshedIdentity.documentEpoch)) &&
      Number(refreshedIdentity.documentEpoch) > 0 &&
      Number(refreshedIdentity.documentEpoch) === Number(liveIdentity.documentEpoch);
    const after = await chrome.tabs.get(expected.id).catch(() => null);
    if (!exact || !after || SciLLM.normalizeTabDocumentUrl(after.url || after.pendingUrl) !==
        SciLLM.normalizeTabDocumentUrl(expected.url)) {
      throw new Error('PENDING_EXTERNAL_INPUT: live article identity changed');
    }
    if (!applyManualAnnotationStateEvent(liveIdentity, tabId)) {
      throw new Error('PENDING_EXTERNAL_INPUT: live article identity changed');
    }
    const refreshedWorkspace = await refreshArticleWorkspace({ force: true });
    if (!refreshedWorkspace) {
      const statusText = String(
        document.getElementById('articleNavigationStatus')?.textContent || ''
      );
      const safeCode = statusText.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ||
        'ARTICLE_WORKSPACE_RELOAD_REFRESH_FAILED';
      throw new Error(safeCode);
    }
    const reloadedDraft = mechanismWorkspaceDraft(currentWorkspaceSnapshot);
    if (!reloadedDraft) throw new Error('EDITABLE_MATRIX_RELOAD_DRAFT_MISSING');
    if (!Array.isArray(reloadedDraft.mechanismChain?.nodes) ||
        reloadedDraft.mechanismChain.nodes.length < 1) {
      throw new Error('EDITABLE_MATRIX_RELOAD_CHAIN_EMPTY');
    }
    switchWorkspaceView('mechanism', { persist: false });
    renderMechanismChainWorkspace(currentWorkspaceSnapshot);
  }, {
    tabId: articleTab.id, liveIdentity,
    expected: { id: articleTab.id, url: articleTab.url }
      })
    }
  });
  try {
    await page.waitForFunction(() =>
      document.querySelector('.workspace-mechanism-matrix'), null, { timeout: 15000 });
  } catch (_) {
    throw new Error('EDITABLE_MATRIX_RELOAD_MATRIX_MISSING');
  }
  try {
    await page.waitForFunction(() =>
      document.querySelector('.workspace-mechanism-mermaid svg'), null, { timeout: 15000 });
  } catch (_) {
    throw new Error('EDITABLE_MATRIX_RELOAD_GRAPH_MISSING');
  }
}

async function graphBytes(page) {
  return page.evaluate(() => {
    const chain = mechanismWorkspaceDraft()?.mechanismChain;
    const mermaid = SciLLM.createMechanismMermaidDefinition(chain, {
      language: interfaceLanguage(), direction: 'LR'
    });
    const layout = mechanismNetworkExportLayout(chain);
    return {
      mermaid,
      svg: SciLLM.serializeMechanismNetworkSvg({
        chain, layout, title: mechanismNetworkPaperIdentity().title
      })
    };
  });
}

async function chainState(page) {
  return page.evaluate(() => {
    const snapshot = currentWorkspaceSnapshot;
    const chain = mechanismWorkspaceDraft(snapshot)?.mechanismChain || {};
    const cross = snapshot?.figures?.crossFigureLogic?.result || {};
    const panelDispositions = Array.isArray(cross?.panelDispositions)
      ? cross.panelDispositions : [];
    const figures = Array.isArray(snapshot?.figures?.figures)
      ? snapshot.figures.figures : [];
    const draftFigures = mechanismWorkspaceDraft(snapshot)?.figures || {};
    const ledgerFigures = figures.map(figure => ({
      figureId: figure?.figureId,
      panelHints: [...new Set([
        ...(Array.isArray(figure?.panelHints) ? figure.panelHints : []),
        ...Object.keys(draftFigures?.[figure?.figureId]?.panels || {})
      ])],
      analysis: {
        panels: Array.isArray(figure?.standard?.panels) ? figure.standard.panels : [],
        argumentChain: Array.isArray(figure?.standard?.argumentChain)
          ? figure.standard.argumentChain : []
      },
      panelAnalyses: figure?.panelAnalyses || {}
    }));
    Object.values(draftFigures).forEach(figure => {
      if (!figure?.figureId || ledgerFigures.some(item => item.figureId === figure.figureId)) return;
      ledgerFigures.push({
        figureId: figure.figureId, panelHints: Object.keys(figure.panels || {}),
        analysis: { panels: [], argumentChain: [] }, panelAnalyses: {}
      });
    });
    const visibleDispositionKeys = [...document.querySelectorAll(
      '[data-panel-disposition-key], [data-panel-key][data-panel-disposition]'
    )].filter(node => node.checkVisibility?.() !== false).map(node =>
      node.dataset.panelDispositionKey || node.dataset.panelKey || ''
    ).filter(Boolean);
    return {
      ledgerFigures, panelDispositions, visibleDispositionKeys,
      tableChips: (Array.isArray(chain.edges) ? chain.edges : []).flatMap(edge =>
        (Array.isArray(edge.panelEvidence) ? edge.panelEvidence : []).map(item => ({
          figureId: item.figureId, panelId: item.panelId
        }))
      ),
      aliases: Object.values(chain.panelAliases || {}).map(item => item?.value).filter(Boolean),
      evidenceClasses: (Array.isArray(chain.edges) ? chain.edges : []).flatMap(edge =>
        (Array.isArray(edge.panelEvidence) ? edge.panelEvidence : []).map(item => ({
          figureId: item.figureId, panelId: item.panelId,
          evidenceClass: item.evidenceClass, evidenceClassSource: item.evidenceClassSource
        }))
      ),
      edges: (Array.isArray(chain.edges) ? chain.edges : []).map(edge => ({
        id: edge.id, from: edge.from, to: edge.to, polarity: edge.polarity,
        humanReviewed: edge?.humanReviewed === true,
        panelEvidence: (Array.isArray(edge.panelEvidence) ? edge.panelEvidence : []).map(item => ({
          figureId: item.figureId, panelId: item.panelId
        }))
      })),
      nodes: (Array.isArray(chain.nodes) ? chain.nodes : []).map(node => ({
        id: node.id,
        label: typeof node?.label === 'object' ? String(node.label?.value || '')
          : String(node?.label || ''),
        humanReviewed: node?.label?.humanReviewed === true
      })),
      nodeCount: chain.nodes?.length || 0,
      edgeCount: chain.edges?.length || 0,
      revision: mechanismWorkspaceDraft(snapshot)?.revision || 0
    };
  });
}

async function screenshot(page, directory, basename, fullPage = true) {
  const target = path.join(directory, basename);
  await page.screenshot({ path: target, fullPage });
  return basename;
}

function screenshotEvidence(directory) {
  return screenshotChecklist.map(filename => {
    const target = path.join(directory, filename);
    if (!fs.existsSync(target)) return { filename, sha256: '', width: 0, height: 0 };
    const bytes = fs.readFileSync(target);
    const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
    return {
      filename,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      width: png ? bytes.readUInt32BE(16) : 0,
      height: png ? bytes.readUInt32BE(20) : 0
    };
  });
}

async function exportMechanismThroughUi(page, directory, format) {
  await page.locator('#openMechanismExportMenu').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator(`[data-mechanism-export="${format}"]`).click()
  ]);
  const target = path.join(directory, `mechanism-network.${format}`);
  await download.saveAs(target);
  const failure = await download.failure();
  if (failure || !fs.existsSync(target) || fs.statSync(target).size < 1) {
    throw new Error('EDITABLE_MATRIX_EXPORT_FAILED');
  }
  return target;
}

async function exportMechanismFormats(page, directory, forbiddenPanelNames) {
  const jsonPath = await exportMechanismThroughUi(page, directory, 'json');
  const svgPath = await exportMechanismThroughUi(page, directory, 'svg');
  const pngPath = await exportMechanismThroughUi(page, directory, 'png');
  JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const svg = fs.readFileSync(svgPath, 'utf8');
  const png = fs.readFileSync(pngPath);
  const graph = auditGraphStability({
    before: { mermaid: '', svg }, afterAlias: { mermaid: '', svg },
    afterClass: { mermaid: '', svg }, forbiddenPanelNames
  });
  if (!graph.panelFree || png.length < 8 || !png.subarray(0, 8).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  )) throw new Error('EDITABLE_MATRIX_EXPORT_FAILED');
  return {
    ok: true,
    jsonBytes: fs.statSync(jsonPath).size,
    svgBytes: fs.statSync(svgPath).size,
    pngBytes: fs.statSync(pngPath).size
  };
}

async function waitSaved(page) {
  await page.waitForFunction(() =>
    document.getElementById('mechanismChainSaveStatus')?.dataset.state !== 'pending',
  null, { timeout: 20000 });
  const failed = await page.locator('#mechanismChainSaveStatus')
    .evaluate(node => node?.dataset.state === 'error').catch(() => false);
  if (failed) throw new Error('Mechanism mutation failed');
}

async function applyMutation(page, mutation) {
  const response = await page.evaluate(async value => {
    try { return await safelyPersistMechanismChainMutation(value); }
    catch (error) { return { success: false, code: error?.code || error?.message }; }
  }, mutation);
  if (!response?.success) throw new Error(`Mutation failed: ${response?.code || 'unknown'}`);
  await waitSaved(page);
  return response;
}

async function firstEmptyCell(page) {
  const cells = page.locator('.workspace-mechanism-matrix td');
  const count = await cells.count();
  for (let index = 0; index < count; index += 1) {
    const cell = cells.nth(index);
    const endpoints = await cell.evaluate(node => ({
      source: node.dataset.sourceNodeId, target: node.dataset.targetNodeId
    }));
    if (endpoints.source !== endpoints.target &&
        await cell.locator('.workspace-mechanism-matrix-evidence').count() === 0) return cell;
  }
  throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
}

async function matrixCellFor(page, endpoints) {
  const cells = page.locator('.workspace-mechanism-matrix td');
  for (let index = 0; index < await cells.count(); index += 1) {
    const cell = cells.nth(index);
    const match = await cell.evaluate((node, expected) =>
      node.dataset.sourceNodeId === expected.source &&
      node.dataset.targetNodeId === expected.target, endpoints);
    if (match) return cell;
  }
  throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
}

async function evidenceOutsideCell(page, endpoints) {
  const chips = page.locator('.workspace-mechanism-matrix-evidence');
  for (let index = 0; index < await chips.count(); index += 1) {
    const chip = chips.nth(index);
    const outside = await chip.evaluate((node, expected) => {
      const cell = node.closest('td');
      return cell?.dataset.sourceNodeId !== expected.source ||
        cell?.dataset.targetNodeId !== expected.target;
    }, endpoints);
    if (outside) return chip;
  }
  throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
}

async function runEditScenarios(
  page, artifactDir, worker, articleTab, expectedIdentity, forbiddenPanelNames = []
) {
  const atStage = async (qaStage, action) => {
    try {
      return await action();
    } catch (error) {
      error.qaStage = qaStage;
      throw error;
    }
  };
  const completed = Object.fromEntries(editScenarioChecklist.map(name => [name, false]));
  const originalGraph = await atStage('edit_initial_graph', () => graphBytes(page));
  const initial = await atStage('edit_initial_chain', () => chainState(page));
  if (initial.nodeCount < 2 || initial.tableChips.length < 1) {
    throw new Error('EDITABLE_MATRIX_INITIAL_MECHANISM_INSUFFICIENT');
  }

  const firstNode = await page.evaluate(() => {
    const node = mechanismWorkspaceDraft()?.mechanismChain?.nodes?.[0];
    return { id: node?.id, label: node?.label?.value || node?.label || '' };
  });
  await atStage('edit_rename_node', () => applyMutation(page, {
    type: 'update_mechanism_node', nodeId: firstNode.id,
    field: 'label', value: `${clean(firstNode.label, 60)} QA renamed`
  }));
  completed.rename_node = true;
  const afterNodeEdit = await graphBytes(page);
  if (byteEqual(originalGraph.mermaid, afterNodeEdit.mermaid)) {
    throw new Error('EDITABLE_MATRIX_NODE_GRAPH_UNCHANGED');
  }

  const beforeAdd = (await chainState(page)).nodeCount;
  const beforeAddGraph = await graphBytes(page);
  await atStage('edit_add_node', () =>
    page.locator('.workspace-mechanism-matrix-add-node').click());
  await page.waitForFunction(count =>
    document.querySelectorAll('.workspace-mechanism-matrix tbody tr').length === count + 1,
  beforeAdd, { timeout: 20000 });
  completed.add_node = true;
  const afterAddGraph = await graphBytes(page);
  if (byteEqual(beforeAddGraph.mermaid, afterAddGraph.mermaid) ||
      byteEqual(beforeAddGraph.svg, afterAddGraph.svg)) {
    throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  }
  const addedNodeId = await page.evaluate(() =>
    mechanismWorkspaceDraft()?.mechanismChain?.nodes?.at(-1)?.id || '');
  await atStage('edit_delete_node', () => applyMutation(
    page, { type: 'remove_mechanism_node', nodeId: addedNodeId }
  ));
  if ((await chainState(page)).nodeCount !== beforeAdd) {
    throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  }
  const afterDeleteGraph = await graphBytes(page);
  if (!byteEqual(beforeAddGraph.mermaid, afterDeleteGraph.mermaid) ||
      !byteEqual(beforeAddGraph.svg, afterDeleteGraph.svg)) {
    throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  }
  completed.delete_node = true;

  const beforeBranch = await chainState(page);
  const branch = await atStage('edit_create_branch', () => page.evaluate(async nodeId =>
    mechanismNetworkViewController.addBranch(nodeId, 'downstream'), firstNode.id));
  if (!branch?.success) throw new Error('EDITABLE_MATRIX_BRANCH_CREATION_FAILED');
  await page.waitForFunction(count =>
    (mechanismWorkspaceDraft()?.mechanismChain?.nodes?.length || 0) === count + 1,
  beforeBranch.nodeCount, { timeout: 20000 });
  const branchNodeVisible = (await chainState(page)).nodeCount === beforeBranch.nodeCount + 1;
  if (!branchNodeVisible) throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  const branchGraph = await graphBytes(page);
  if (byteEqual(afterDeleteGraph.mermaid, branchGraph.mermaid) ||
      byteEqual(afterDeleteGraph.svg, branchGraph.svg)) {
    throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  }
  completed.create_branch = true;
  const ids = await page.evaluate(() =>
    mechanismWorkspaceDraft()?.mechanismChain?.nodes?.map(node => node.id) || []);
  const branchNodeId = ids.at(-1);
  const feedback = await atStage('edit_create_feedback', () => page.evaluate(async ({ from, to }) =>
    mechanismNetworkViewController.addConnection(from, to, 'negative'), {
    from: ids.at(-1), to: ids[0]
  }));
  if (!feedback?.success) throw new Error('EDITABLE_MATRIX_FEEDBACK_CREATION_FAILED');
  await page.waitForFunction(({ from, to }) =>
    mechanismWorkspaceDraft()?.mechanismChain?.edges?.some(edge =>
      edge.from === from && edge.to === to && edge.polarity === 'negative'
    ), { from: ids.at(-1), to: ids[0] }, { timeout: 20000 });
  const feedbackEdgeVisible = (await chainState(page)).edges.some(edge =>
    edge.from === ids.at(-1) && edge.to === ids[0] && edge.polarity === 'negative');
  if (!feedbackEdgeVisible) throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  const expectedGraphEdges = (await chainState(page)).edgeCount;
  await page.waitForFunction(count =>
    document.querySelectorAll('.workspace-mechanism-mermaid path.flowchart-link').length >= count,
  expectedGraphEdges, { timeout: 30000 });
  const feedbackGraph = await graphBytes(page);
  if (byteEqual(branchGraph.mermaid, feedbackGraph.mermaid) ||
      byteEqual(branchGraph.svg, feedbackGraph.svg)) {
    throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  }
  completed.create_feedback_cycle = true;
  await screenshot(page, artifactDir, 'desktop-cycle-feedback-graph.png');

  await page.setViewportSize({ width: 700, height: 1000 });
  await screenshot(page, artifactDir, 'desktop-full-matrix-graph.png');
  await page.locator('.workspace-mechanism-matrix-legend').scrollIntoViewIfNeeded();
  await screenshot(page, artifactDir, 'desktop-bottom-legend.png');
  await page.setViewportSize({ width: 380, height: 900 });
  await screenshot(page, artifactDir, 'narrow-full-matrix-graph.png');
  await page.locator('.workspace-mechanism-matrix-scroll').evaluate(node => {
    node.scrollLeft = node.scrollWidth;
    node.scrollTop = Math.min(node.scrollHeight, 160);
  });
  await screenshot(page, artifactDir, 'narrow-sticky-headers-scrolled.png');

  const empty = await firstEmptyCell(page);
  const emptyEndpoints = await empty.evaluate(node => ({
    source: node.dataset.sourceNodeId, target: node.dataset.targetNodeId
  }));
  const evidenceCountBeforeAdd = (await chainState(page)).tableChips.length;
  await empty.locator('.workspace-mechanism-matrix-cell-edit').click();
  await screenshot(page, artifactDir, 'narrow-empty-cell-editor.png');
  const editor = page.locator('.workspace-mechanism-matrix-cell-editor');
  const panelSelect = editor.locator('.workspace-mechanism-matrix-cell-panel');
  const firstPanelValue = await panelSelect.locator('option').nth(1).getAttribute('value');
  if (!firstPanelValue) throw new Error('EDITABLE_MATRIX_EMPTY_CELL_PANEL_UNAVAILABLE');
  await panelSelect.selectOption(firstPanelValue);
  await editor.getByRole('button', { name: /添加证据|Add evidence/u }).click();
  await page.waitForFunction(count => {
    const chain = mechanismWorkspaceDraft()?.mechanismChain;
    return (chain?.edges || []).reduce((sum, edge) =>
      sum + (edge.panelEvidence?.length || 0), 0) === count + 1;
  }, evidenceCountBeforeAdd, { timeout: 20000 });
  const evidenceCountAfterAdd = (await chainState(page)).tableChips.length;
  if (evidenceCountAfterAdd !== evidenceCountBeforeAdd + 1) {
    throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  }
  completed.add_evidence_to_empty_cell = true;
  const graphOnlyBaseline = await graphBytes(page);

  await page.setViewportSize({ width: 700, height: 1000 });
  await page.waitForFunction(() =>
    document.querySelector('.workspace-mechanism-matrix') &&
    !document.querySelector('.workspace-mechanism-matrix-cell-editor'),
  null, { timeout: 20000 });
  const populated = await evidenceOutsideCell(page, emptyEndpoints);
  await populated.click();
  await screenshot(page, artifactDir, 'desktop-populated-cell-editor.png');
  const alias = page.locator('.workspace-mechanism-matrix-cell-editor '
    + '.workspace-mechanism-matrix-cell-alias').first();
  const longAlias = 'Long reviewed Panel alias proving table-only ellipsis behavior 0123456789';
  await alias.fill(longAlias);
  await page.locator('.workspace-mechanism-matrix-cell-editor')
    .getByRole('button', { name: /保存名称|Save name/u }).first().click();
  await page.waitForFunction(value =>
    Object.values(mechanismWorkspaceDraft()?.mechanismChain?.panelAliases || {})
      .some(item => item?.value === value), longAlias, { timeout: 20000 });
  const aliasVisibleInTable = await page.locator('.workspace-mechanism-matrix-evidence')
    .filter({ hasText: longAlias }).count() > 0;
  if (!aliasVisibleInTable) throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  completed.change_panel_alias = true;
  const afterAlias = await graphBytes(page);
  for (const evidenceClass of ['other', 'sufficiency', 'necessity']) {
    await page.locator('.workspace-mechanism-matrix-evidence')
      .filter({ hasText: longAlias }).first().click();
    const classSelect = page.locator('.workspace-mechanism-matrix-cell-editor '
      + '.workspace-mechanism-matrix-cell-evidence .workspace-mechanism-matrix-cell-class').first();
    await classSelect.selectOption(evidenceClass);
    await page.waitForFunction(({ aliasValue, className }) =>
      [...document.querySelectorAll('.workspace-mechanism-matrix-evidence')]
        .some(node => node.textContent === aliasValue && node.classList.contains(`is-${className}`)),
    { aliasValue: longAlias, className: evidenceClass }, { timeout: 20000 });
    const classVisibleInTable = await page.locator(
      `.workspace-mechanism-matrix-evidence.is-${evidenceClass}`
    ).filter({ hasText: longAlias }).count() > 0;
    if (!classVisibleInTable) throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  }
  completed.switch_evidence_classes = true;
  const afterClass = await graphBytes(page);
  await page.setViewportSize({ width: 380, height: 900 });
  await screenshot(page, artifactDir, 'narrow-long-alias-ellipsis.png');
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.waitForFunction(() =>
    document.querySelector('.workspace-mechanism-matrix') &&
    !document.querySelector('.workspace-mechanism-matrix-cell-editor'),
  null, { timeout: 20000 });
  const evidenceCountBeforeDelete = (await chainState(page)).tableChips.length;
  const addedCell = await matrixCellFor(page, emptyEndpoints);
  await addedCell.locator('.workspace-mechanism-matrix-evidence').first().click();
  await page.locator('.workspace-mechanism-matrix-cell-editor')
    .getByRole('button', { name: /删除证据|Delete evidence/u }).first().click();
  await page.waitForFunction(count => {
    const chain = mechanismWorkspaceDraft()?.mechanismChain;
    return (chain?.edges || []).reduce((sum, edge) =>
      sum + (edge.panelEvidence?.length || 0), 0) === count - 1;
  }, evidenceCountBeforeDelete, { timeout: 20000 });
  const evidenceCountAfterDelete = (await chainState(page)).tableChips.length;
  if (evidenceCountAfterDelete !== evidenceCountBeforeDelete - 1) {
    throw new Error('EDITABLE_MATRIX_SCENARIO_FAILED');
  }
  completed.delete_evidence = true;

  const persistedExpectation = await chainState(page);
  await page.evaluate(async () => refreshArticleWorkspace({ announce: true }));
  const beforeReloadRefresh = await chainState(page);
  if (beforeReloadRefresh.nodeCount < 1) {
    const error = new Error('EDITABLE_MATRIX_PRE_RELOAD_REFRESH_CHAIN_EMPTY');
    error.qaStage = 'pre_reload_refresh';
    throw error;
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await rebindPanelAfterReload(page, worker, articleTab, expectedIdentity);
  } catch (error) {
    error.qaStage = 'reload_rebind';
    throw error;
  }
  const reloaded = await chainState(page);
  const stable = value => JSON.stringify(value);
  if (!reloaded.aliases.includes(longAlias) ||
      stable(reloaded.nodes) !== stable(persistedExpectation.nodes) ||
      stable(reloaded.edges) !== stable(persistedExpectation.edges) ||
      stable(reloaded.evidenceClasses) !== stable(persistedExpectation.evidenceClasses) ||
      reloaded.tableChips.length !== persistedExpectation.tableChips.length) {
    const error = new Error('EDITABLE_MATRIX_RELOAD_PERSISTENCE_FAILED');
    error.qaStage = 'reload_persistence';
    throw error;
  }
  completed.reload = true;
  await screenshot(page, artifactDir, 'narrow-reloaded-state.png');

  const beforeRegenerate = await chainState(page);
  const regeneration = await page.evaluate(async () => {
    switchWorkspaceView('mechanism', { persist: false });
    const snapshot = currentWorkspaceSnapshot;
    const generated = SciLLM.mechanismChainFromCrossFigure(
      snapshot?.figures?.crossFigureLogic?.result,
      mechanismWorkspaceFigures(snapshot)
    );
    const result = await seedMechanismChainFromCrossFigure(currentWorkspaceSnapshot, {
      explicit: true
    });
    return { result, generated };
  });
  if (regeneration?.result?.success !== true) {
    const error = new Error('EDITABLE_MATRIX_REGENERATION_CALL_FAILED');
    error.qaStage = 'regeneration_call';
    throw error;
  }
  const regenerated = await chainState(page);
  const regenerationAudit = auditRegeneration({
    success: regeneration.result.success,
    before: beforeRegenerate,
    generated: regeneration.generated,
    after: regenerated
  });
  const missingReviewedNodes = persistedExpectation.nodes
    .filter(expected => expected.humanReviewed)
    .filter(expected => !regenerated.nodes.some(actual =>
      actual.id === expected.id && actual.label === expected.label));
  const reviewedNodesSurvive = missingReviewedNodes.length === 0;
  const reviewedEdgesSurvive = persistedExpectation.edges
    .filter(expected => expected.humanReviewed)
    .every(expected => regenerated.edges.some(actual =>
      actual.id === expected.id && actual.from === expected.from &&
      actual.to === expected.to && actual.polarity === expected.polarity));
  const manualClassesSurvive = persistedExpectation.evidenceClasses
    .filter(item => item.evidenceClassSource === 'manual').every(expected =>
      regenerated.evidenceClasses.some(actual => actual.figureId === expected.figureId &&
        actual.panelId === expected.panelId && actual.evidenceClass === expected.evidenceClass &&
        actual.evidenceClassSource === 'manual'));
  const regenerationFailure = !regenerationAudit.ok
    ? 'EDITABLE_MATRIX_REGENERATION_AUDIT_FAILED'
    : regenerated.nodeCount < 1
      ? 'EDITABLE_MATRIX_REGENERATION_EMPTY'
      : !regenerated.aliases.includes(longAlias)
        ? 'EDITABLE_MATRIX_REGENERATION_ALIAS_LOST'
        : !reviewedNodesSurvive
          ? missingReviewedNodes.some(node => node.id === firstNode.id)
            ? regenerated.nodes.some(node => node.id === firstNode.id)
              ? 'EDITABLE_MATRIX_REGENERATION_RENAMED_NODE_LABEL_CHANGED'
              : 'EDITABLE_MATRIX_REGENERATION_RENAMED_NODE_LOST'
            : missingReviewedNodes.some(node => node.id === branchNodeId)
              ? regenerated.nodes.some(node => node.id === branchNodeId)
                ? 'EDITABLE_MATRIX_REGENERATION_BRANCH_NODE_LABEL_CHANGED'
                : 'EDITABLE_MATRIX_REGENERATION_BRANCH_NODE_LOST'
              : 'EDITABLE_MATRIX_REGENERATION_NODE_LOST'
          : !reviewedEdgesSurvive
            ? 'EDITABLE_MATRIX_REGENERATION_EDGE_LOST'
            : !manualClassesSurvive
              ? 'EDITABLE_MATRIX_REGENERATION_CLASS_LOST'
              : regenerated.nodes.some(node => node.id === addedNodeId)
                ? 'EDITABLE_MATRIX_REGENERATION_DELETED_NODE_RETURNED' : '';
  if (regenerationFailure) {
    const error = new Error(regenerationFailure);
    error.qaStage = 'regeneration_preservation';
    throw error;
  }
  completed.regenerate = true;
  let exports;
  try {
    exports = await exportMechanismFormats(
      page, artifactDir, [...forbiddenPanelNames, longAlias]
    );
  } catch (error) {
    error.qaStage = 'export';
    throw error;
  }
  completed.export = exports.ok;
  return {
    ok: Object.values(completed).every(Boolean), completed,
    graph: { baseline: graphOnlyBaseline, afterAlias, afterClass },
    exports
  };
}

function nativeInspectionFor(input, paperKey, evidence) {
  const record = input?.papers?.[paperKey] || input?.[paperKey] || {};
  return auditNativeInspection(record, evidence);
}

async function runPaper(
  context, worker, workerDiagnostics, extensionId, paper, outputDir, inspection
) {
  const paperDir = path.join(outputDir, paper.key);
  fs.mkdirSync(paperDir, { recursive: true });
  const pdfSha256 = sha256File(paper.pdfPath);
  const archiveSha256 = sha256File(paper.archivePath);
  const panelManifestSha256 = panelManifestHash(paper.originalPanels);
  const pageCount = await pdfPageCount(paper.pdfPath);
  const archive = JSON.parse(fs.readFileSync(paper.archivePath, 'utf8'));
  const articlePage = await context.newPage();
  const articleDiagnostics = diagnosticsFor(articlePage, { strictConsole: false });
  let panel;
  let stage = 'article_navigation';
  try {
    await articlePage.goto(paper.articleUrl, {
      waitUntil: 'domcontentloaded', timeout: 90000
    });
    stage = 'article_title';
    const liveTitle = await waitForMatchingArticleTitle(articlePage, paper.title);
    await articlePage.waitForLoadState('load', { timeout: 90000 });
    const paperBindings = {
      pdfSha256, archiveSha256, panelManifestSha256, pageCount,
      archiveTitle: archive?.title || archive?.documentRecord?.title || '',
      liveArticleTitle: liveTitle.title
    };
    const identityAudit = auditPaperBindings(paper, paperBindings);
    const inspectionBindings = {
      paperKey: paper.key, pdfSha256, archiveSha256, panelManifestSha256
    };
    if (!identityAudit.ok ||
        !auditOriginalPanelInspection(paper.originalPanelInspection, inspectionBindings).ok) {
      throw new Error(`PENDING_EXTERNAL_INPUT: paper identity binding mismatch for ${paper.key}`);
    }
    stage = 'article_activation';
    const tab = await activateArticle(worker, articlePage);
    stage = 'archive_restore';
    const opened = await openPanel(context, worker, extensionId, tab, archive);
    panel = opened.page;
    const panelDiagnostics = opened.diagnostics;
    stage = 'initial_chain';
    const initial = await chainState(panel);
    const canonicalPanelLedger = panelLedgerCore.buildPanelLedger(initial.ledgerFigures);
    if (!canonicalPanelLedger.entries.length) throw new Error('CANONICAL_PANEL_LEDGER_EMPTY');
    const dispositionByKey = new Map(initial.panelDispositions.map(item => [
      clean(item?.panelKey, 300), dispositionOf(item)
    ]));
    const canonicalLedgerWithDispositions = canonicalPanelLedger.entries.map(entry => ({
      figureId: entry.figureId, panelId: entry.panelId,
      disposition: dispositionByKey.get(entry.panelKey) || ''
    }));
    const coverage = auditPanelCoverage({
      ledger: canonicalLedgerWithDispositions,
      originalPanels: paper.originalPanels,
      tableChips: initial.tableChips,
      visibleDispositionKeys: initial.visibleDispositionKeys
    });
    const originalInspection = auditOriginalPanelInspection(
      paper.originalPanelInspection, inspectionBindings
    );
    const panelNames = paper.originalPanels.map(item =>
      clean(item.displayId || item.displayAlias, 100)
    ).filter(Boolean);
    stage = 'edit_scenarios';
    const edits = await runEditScenarios(
      panel, paperDir, worker, tab, opened.preparedIdentity, panelNames
    );
    const graph = auditGraphStability({
      before: edits.graph.baseline,
      afterAlias: edits.graph.afterAlias,
      afterClass: edits.graph.afterClass,
      forbiddenPanelNames: [
        ...panelNames,
        ...initial.aliases
      ]
    });
    const evidence = screenshotEvidence(paperDir);
    const nativeInspection = nativeInspectionFor(inspection, paper.key, evidence);
    const screenshots = {
      ok: evidence.every(item => item.sha256 && item.width > 0 && item.height > 0),
      count: evidence.filter(item => item.sha256 && item.width > 0 && item.height > 0).length,
      expected: screenshotChecklist.length,
      files: screenshotChecklist,
      evidence
    };
    const diagnostics = {
      unhandledErrors: articleDiagnostics.unhandledErrors.length +
        panelDiagnostics.unhandledErrors.length + workerDiagnostics.unhandledErrors.length,
      consoleErrors: articleDiagnostics.consoleErrors.length +
        panelDiagnostics.consoleErrors.length + workerDiagnostics.consoleErrors.length,
      publisherConsoleErrors: articleDiagnostics.observedConsoleErrors.length
    };
    const metadata = {
      ...paper,
      sha256: pdfSha256,
      pageCount
    };
    const pass = process.env.HEADLESS === '0' && coverage.ok && edits.ok && graph.ok &&
      edits.exports.ok && screenshots.ok && nativeInspection.ok &&
      diagnostics.unhandledErrors === 0 && diagnostics.consoleErrors === 0;
    stage = 'result';
    return publicPaperResult({
      ...metadata,
      coverage: { ...coverage, originalArticleReviewed: originalInspection.ok },
      edits: { ok: edits.ok, completed: edits.completed, graph },
      exports: edits.exports, screenshots, nativeInspection, diagnostics, pass
    });
  } catch (error) {
    const errorMessage = String(error?.message || error);
    const tokens = errorMessage.match(/[A-Z][A-Z0-9_]{3,}/gu) || [];
    const postCommitProof = safePostCommitProofDiagnosticsFromError(errorMessage);
    console.error(JSON.stringify({
      qaStage: clean(error?.qaStage || stage, 80),
      errorCodes: tokens.slice(0, 4),
      ...(postCommitProof ? { postCommitProof } : {})
    }));
    throw error;
  } finally {
    workerDiagnostics.dispose?.();
    await panel?.close().catch(() => undefined);
    await articlePage.close().catch(() => undefined);
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) { console.log(helpText()); return; }
  const outputDir = path.resolve(args.output || process.env.OUTPUT_DIR ||
    path.join(root, 'output', 'playwright', 'editable-mechanism-matrix'));
  beginReport(outputDir);
  const inputValue = String(args.input || process.env.MATRIX_QA_INPUT || '').trim();
  if (!inputValue) {
    throw new Error('PENDING_EXTERNAL_INPUT: set --input or MATRIX_QA_INPUT');
  }
  const inputPath = path.resolve(inputValue);
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    throw new Error('PENDING_EXTERNAL_INPUT: private input file is missing');
  }
  const privateInput = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const papers = validatePrivateInput(privateInput);
  const extensionPath = locateExtension(args.extension);
  if (!extensionPath) {
    throw new Error('PENDING_EXTERNAL_INPUT: set --extension or EXTENSION_PATH');
  }
  if (!extensionPath || !fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error('PENDING_EXTERNAL_INPUT: unpacked extension is missing');
  }
  const extensionBuild = extensionBuildBinding(extensionPath);
  const inspectionValue = String(args.inspection || process.env.MATRIX_NATIVE_INSPECTION ||
    privateInput.nativeInspectionPath || '').trim();
  const inspectionPath = inspectionValue ? path.resolve(inspectionValue) : '';
  const inspection = inspectionPath && fs.existsSync(inspectionPath) &&
    fs.statSync(inspectionPath).isFile()
    ? JSON.parse(fs.readFileSync(inspectionPath, 'utf8')) : {};
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-matrix-qa-'));
  let context;
  const results = [];
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'msedge',
      headless: process.env.HEADLESS !== '0',
      viewport: { width: 1280, height: 1000 },
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
    const initialWorker = await extensionWorker(context);
    const extensionId = new URL(initialWorker.url()).host;
    for (const paper of papers) {
      const worker = await liveExtensionWorker(context, extensionId);
      const workerDiagnostics = diagnosticsForWorker(worker);
      results.push(await runPaper(
        context, worker, workerDiagnostics, extensionId, paper, outputDir, inspection
      ));
    }
  } finally {
    await context?.close().catch(() => undefined);
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
  const report = {
    schemaVersion: 1,
    runId: activeReport.runId, generatedAt: activeReport.generatedAt,
    status: 'COMPLETED', extensionBuild: extensionBuild,
    headedEdge: process.env.HEADLESS === '0',
    papers: results,
    pass: results.length === requiredPapers.length && results.every(item => item.pass)
  };
  writeReportAtomically(activeReport.filename, report);
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
    if (activeReport?.filename) writeReportAtomically(activeReport.filename, failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  });
}
