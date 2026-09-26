import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scoreSpans } from './benchmark-scenario-prompts.mjs';

const root = path.resolve(import.meta.dirname, '..');

export function normalizePredictionSpans(annotations) {
  const normalized = [];
  const seen = new Set();
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    const categoryEntries = annotation?.categoryId
      ? [{ categoryId: annotation.categoryId }]
      : Array.isArray(annotation?.categories) ? annotation.categories : [];
    for (const category of categoryEntries) {
      const categoryId = String(category?.categoryId || '').trim();
      const paragraphId = String(annotation?.paragraphId || '').trim();
      const start = Number(annotation?.start);
      const end = Number(annotation?.end);
      if (!categoryId || !paragraphId || !Number.isInteger(start) ||
          !Number.isInteger(end) || start < 0 || end <= start) continue;
      const key = `${paragraphId}\u0000${start}\u0000${end}\u0000${categoryId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({
        ...annotation,
        ...category,
        paragraphId,
        start,
        end,
        categoryId,
        categories: undefined
      });
    }
  }
  return normalized;
}

export function scoreGroupKey(report, call) {
  const base = `${call.model}/${call.variant}`;
  return report.scope === 'presets' ? `${base}/${call.viewId}` : base;
}

export function groupScenarioCalls(report) {
  const groups = new Map();
  for (const call of report.calls || []) {
    const key = scoreGroupKey(report, call);
    const group = groups.get(key) || [];
    group.push(call);
    groups.set(key, group);
  }
  return groups;
}

export function scoreScenarioRun(directoryArgument, options = {}) {
  const directory = path.resolve(
    options.rootDir || root, directoryArgument || 'tmp/scenario-corpus-v1/dev-pilot-02'
  );
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json')));
  const referencePath = path.join(
    options.rootDir || root, 'tmp/scenario-corpus-v1', `${report.split}.annotations.jsonl`
  );
  const referenceText = options.referenceText === undefined
    ? fs.readFileSync(referencePath, 'utf8') : String(options.referenceText);
  const referenceLabelsSha256 = createHash('sha256').update(referenceText).digest('hex');
  const labels = referenceText.trim().split(/\r?\n/u).map(JSON.parse);
  const refs = new Map(labels.map(row => [row.recordId,row]));
  const scoredRecordIds = new Set(report.records || report.calls.map(call => call.recordId));
  const excludedAmbiguousParagraphs = labels
    .filter(row => scoredRecordIds.has(row.recordId))
    .reduce((sum, row) => sum + new Set((row.abstentions || [])
      .map(item => item.paragraphId)).size, 0);
  const out = {
    split: report.split,
    promptSha256: report.promptSha256,
    baselinePromptSha256: report.baselinePromptSha256,
    sourceHashes: report.sourceHashes,
    candidateFreezeSha256: report.candidateFreezeSha256,
    categorySha256: report.categorySha256,
    referenceLabelsSha256,
    excludedAmbiguousParagraphs,
    realApiCalls: report.realApiCalls,
    executionMode: report.executionMode || 'single_pass',
    evaluationContext: report.scope === 'presets'
      ? 'supplementary_exploratory_default-scenario measurement; do not tune prompts from these results or compare them directly with the 17-category union baseline'
      : report.evaluationContext,
    unitOfAnalysis: report.scope === 'presets' ? 'record-scenario call' : 'record window',
    interpretation: 'Character-span agreement with assistant silver labels, NOT human-validated precision/recall. Ambiguous paragraphs excluded from scores and counted separately. Rare/absent categories not established.',
    groups: {}
  };
  for (const [groupId, calls] of groupScenarioCalls(report)) {
    const reference = [], prediction = [], errors = {}, recordScores = [];
    let groupExcludedAmbiguousParagraphs = 0;
    for (const call of calls) {
      const ref = refs.get(call.recordId);
      if (!ref) throw new Error(`MISSING_REFERENCE:${call.recordId}`);
      const excluded = new Set((ref.abstentions || []).map(item => item.paragraphId));
      groupExcludedAmbiguousParagraphs += excluded.size;
      const legacyArtifactFile = `${call.recordId}-${call.model}-${call.variant}.json`;
      const result = JSON.parse(fs.readFileSync(
        path.join(directory, call.artifactFile || legacyArtifactFile)
      ));
      const active = new Set(call.requestedCategoryIds || report.categoryIds);
      const a = ref.labels.filter(label =>
        active.has(label.categoryId) && !excluded.has(label.paragraphId));
      const b = normalizePredictionSpans(result.annotations).filter(label =>
        active.has(label.categoryId) && !excluded.has(label.paragraphId));
      reference.push(...a);
      prediction.push(...b);
      recordScores.push({
        recordId: call.recordId,
        viewId: call.viewId,
        status: call.status,
        referenceSpans: a.length,
        predictedSpans: b.length,
        ...scoreSpans(a,b).micro
      });
      for (const item of call.rejected || []) {
        errors[item.reason] = (errors[item.reason] || 0) + 1;
      }
    }
    out.groups[groupId] = {
      records: new Set(calls.map(call => call.recordId)).size,
      scenarioCalls: calls.length,
      complete: calls.filter(call => call.complete).length,
      referenceSpans: reference.length,
      predictedSpans: prediction.length,
      excludedAmbiguousParagraphs: groupExcludedAmbiguousParagraphs,
      ...scoreSpans(reference,prediction),
      rejections: errors,
      recordScores,
      totalMs: calls.reduce((sum, call) => sum + call.elapsedMs, 0),
      totalTokens: calls.reduce((sum, call) =>
        sum + (call.usage?.inputTokens || 0) + (call.usage?.outputTokens || 0), 0)
    };
  }
  fs.writeFileSync(path.join(directory,'silver-metrics.json'),JSON.stringify(out,null,2));
  return out;
}

function printSummary(out) {
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out.groups)
    .map(([id,value]) => [id, {
      complete: value.complete,
      records: value.records,
      scenarioCalls: value.scenarioCalls,
      ...value.micro,
      rejections: value.rejections,
      excludedAmbiguousParagraphs: value.excludedAmbiguousParagraphs,
      totalTokens: value.totalTokens
    }]))));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  printSummary(scoreScenarioRun(process.argv[2]));
}
