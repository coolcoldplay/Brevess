import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };

export async function prepareFigureInput(args) {
  if (!args.sourceManifest || !args.article) fail('LIVE_FIGURE_SOURCE_REQUIRED');
  if (Boolean(args.portableConfig) !== Boolean(args.profile)) fail('LIVE_FIGURE_PROFILE_REQUIRED');
  if (args.replayDir || args.replayDelayMs || args.strictReplay) fail('LIVE_FIGURE_SOURCE_REPLAY_FORBIDDEN');
  const model = args.model;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(model) ||
      /^sk-/i.test(model) || ['text', 'pro', 'vision'].includes(model)) fail('LIVE_FIGURE_MODEL_INVALID');
  if (args.provider && args.provider !== 'deepseek') fail('LIVE_FIGURE_PROVIDER_UNSUPPORTED');
  let url;
  try { url = new URL(args.baseUrl || 'https://api.deepseek.com/chat/completions'); }
  catch { fail('LIVE_FIGURE_PROVIDER_UNSUPPORTED'); }
  if (url.origin !== 'https://api.deepseek.com' || url.username || url.password || url.search || url.hash ||
      !['/', '/v1', '/v1/', '/chat/completions', '/responses'].includes(url.pathname)) {
    fail('LIVE_FIGURE_PROVIDER_UNSUPPORTED');
  }
  const baseUrl = url.pathname === '/responses' ? url.href : 'https://api.deepseek.com/chat/completions';
  const numberOption = (key, fallback, min, max) => {
    const value = Number(args[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) fail('LIVE_FIGURE_LIMIT_INVALID');
    return value;
  };
  const callCap = numberOption('callCap', 8, 1, 16);
  const timeoutMs = numberOption('providerTimeoutMs', 180000, 1000, 180000);
  const deadlineMs = numberOption('deadlineMs', 600000, 1000, 1800000);
  const { loadMechanismArticle } = await import('./mechanism-acceptance-input.mjs');
  const article = loadMechanismArticle(args.article, args.sourceManifest);
  const selectedFigures = article.figures.filter(f => f.sourceId === args.figure);
  if (!args.bundleRuns && selectedFigures.length !== 1) fail('LIVE_FIGURE_SELECTION_INVALID');
  if (args.bundleRuns && args.figure) fail('LIVE_FIGURE_MODE_CONFLICT');
  const sourceBinding = {
    articleSha256: hash(fs.readFileSync(args.article)),
    manifestSha256: hash(fs.readFileSync(args.sourceManifest)),
    images: article.figures.map(f => ({ sourceId: f.sourceId, sha256: hash(f.imageBytes) }))
  };
  return { article, selectedFigures, selectedModel: model, modelMode: model,
    sourceBinding, baseUrl, callCap, timeoutMs, deadlineMs };
}

// Only combines existing captures. It does not synthesize, repair or rewrite a provider body.
export async function bundleFigureCaptures(input, runDirectories, outputDirectory) {
  const { loadReplayEntries, sanitizedArtifact } = await import('../verify-live-figure-extension.mjs');
  const { assertFigureReplaySource } = await import('./mechanism-acceptance-input.mjs');
  if (!Array.isArray(runDirectories) || runDirectories.length !== input.article.figures.length ||
      new Set(runDirectories.map(d => path.resolve(d))).size !== runDirectories.length) {
    fail('LIVE_FIGURE_BUNDLE_INCOMPLETE');
  }
  if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length) {
    fail('LIVE_FIGURE_OUTPUT_NOT_EMPTY');
  }
  const groups = new Map();
  let sourceHashes;
  for (const directory of runDirectories) {
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
    const ids = report.selectedFigureIds;
    if (report.outcome?.status !== 'PASS' || report.provider !== 'deepseek' ||
        report.replayedCalls !== 0 || report.callCapRejected || !Array.isArray(ids) || ids.length !== 1 ||
        !isDeepStrictEqual(report.sourceBinding, input.sourceBinding) ||
        report.configuredModel !== input.selectedModel || report.providerBaseUrl !== input.baseUrl ||
        !report.sourceHashes || !Object.keys(report.sourceHashes).length ||
        (sourceHashes && !isDeepStrictEqual(report.sourceHashes, sourceHashes))) {
      fail('LIVE_FIGURE_BUNDLE_SOURCE_MISMATCH');
    }
    sourceHashes = report.sourceHashes;
    const figure = input.article.figures.find(f => f.sourceId === ids[0]);
    if (!figure || groups.has(ids[0])) fail('LIVE_FIGURE_BUNDLE_SOURCE_MISMATCH');
    const entries = loadReplayEntries(directory);
    if (report.realApiCalls !== entries.length || entries.some(e => e.status !== 200 ||
        e.requestBody.model !== input.selectedModel || e.endpoint !== '/chat/completions')) {
      fail('LIVE_FIGURE_BUNDLE_SOURCE_MISMATCH');
    }
    assertFigureReplaySource(entries, { ...input.article, figures: [figure] });
    groups.set(ids[0], { directory, report, entries });
  }
  const ordered = input.article.figures.flatMap(f => {
    const group = groups.get(f.sourceId);
    if (!group) fail('LIVE_FIGURE_BUNDLE_INCOMPLETE');
    return group.entries.map((entry, index) => ({ ...group, entry, call: group.report.providerCalls[index] }));
  });
  if (ordered.length > 512) fail('LIVE_FIGURE_BUNDLE_TOO_LARGE');
  assertFigureReplaySource(ordered.map(item => item.entry), input.article);
  // Inspect every byte before creating the bundle; sanitization must not change capture semantics.
  const artifacts = ordered.map(({ directory, call }, index) => {
    const names = ['request', 'response'];
    const values = names.map(kind => {
      const original = fs.readFileSync(path.join(directory, call.artifacts[kind]), 'utf8');
      if (!isDeepStrictEqual(JSON.parse(sanitizedArtifact(original)), JSON.parse(original))) {
        fail('LIVE_FIGURE_BUNDLE_UNREDACTED');
      }
      return { kind, original, name: `provider-${kind}-${String(index + 1).padStart(3, '0')}-redacted.json` };
    });
    return values;
  });
  const report = { schemaVersion: 1, acceptance: 'offline assembly of source-bound real Figure captures',
    provider: 'captured-real-deepseek', configuredModel: input.selectedModel,
    sourceBinding: input.sourceBinding, sourceHashes, realApiCalls: 0, replayedCalls: 0,
    capturedRealApiCalls: ordered.length, outcome: { status: 'INPUT_READY' },
    sourceRuns: input.article.figures.map(f => ({ sourceId: f.sourceId,
      reportSha256: hash(fs.readFileSync(path.join(groups.get(f.sourceId).directory, 'report.json'))) })),
    providerCalls: ordered.map(({ call }, index) => ({ ...call, sequence: index + 1,
      artifacts: Object.fromEntries(artifacts[index].map(a => [a.kind, a.name])) })) };
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const files of artifacts) for (const file of files) {
    fs.writeFileSync(path.join(outputDirectory, file.name), file.original, { flag: 'wx', mode: 0o600 });
  }
  fs.writeFileSync(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  return report;
}

export function createFigureDeadline(durationMs) {
  const controller = new AbortController();
  const expiresAt = Date.now() + durationMs;
  const error = Object.assign(new Error('LIVE_FIGURE_DEADLINE_EXCEEDED'), { code: 'LIVE_FIGURE_DEADLINE_EXCEEDED' });
  const timer = setTimeout(() => controller.abort(error), durationMs);
  const check = () => { if (Date.now() >= expiresAt || controller.signal.aborted) throw error; };
  return { signal: controller.signal, check, remainingMs: () => Math.max(0, expiresAt - Date.now()),
    dispose: () => clearTimeout(timer),
    async run(operation) {
      check();
      let abort;
      const expired = new Promise((_, reject) => { abort = () => reject(error);
        controller.signal.addEventListener('abort', abort, { once: true }); });
      try { return await Promise.race([Promise.resolve().then(operation), expired]); }
      finally { controller.signal.removeEventListener('abort', abort); }
    } };
}
