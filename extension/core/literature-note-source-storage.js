(function attach(root, factory) {
  const api = factory(root.SciLLM || {}, () => root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared, currentShared) {
  let sourceTools = shared;
  if (typeof sourceTools.projectLiteratureNoteSources !== 'function' && typeof require === 'function') {
    try { sourceTools = require('./literature-note-sources.js'); } catch (_) {}
  }
  let noteTools = shared;
  if (typeof noteTools.literatureNoteRequestPolicy !== 'function' && typeof require === 'function') {
    try { noteTools = require('./reading-tools.js'); } catch (_) {}
  }
  const LITERATURE_NOTE_SOURCE_STORAGE_LIMITS = Object.freeze({
    maxValueLength: 12000, maxSourceIds: 12, maxInputSourceIds: 2048, maxReceiptRecords: 20000
  });
  const LIMITS = LITERATURE_NOTE_SOURCE_STORAGE_LIMITS;
  const LITERATURE_NOTE_FIELD_SOURCE_LABEL = 'Field sources (not assigned to individual paragraphs):';
  const CURRENT_ID = /^p-[0-9a-f]{16}$/;
  const LITERATURE_NOTE_SOURCE_STORAGE_WARNINGS = Object.freeze({
    invalidValue: '来源未保存：笔记正文必须为非空字符串。',
    tooLong: '来源未保存：追加引用会超过 12000 字符，正文已完整保留。',
    noSources: '来源未保存：生成结果未提供可保存的来源。',
    invalidIds: '来源未保存：来源 ID 不符合当前段落引用格式。',
    limit: '来源未保存：来源信息超出安全处理范围。',
    missingReceipt: '来源未保存：缺少本次生成的来源回执。',
    wrongDocument: '来源未保存：来源回执与当前文献不一致。',
    missingRecord: '来源未保存：回执未包含全部指定段落。',
    ambiguousRecord: '来源未保存：回执中段落 ID 重复或相互矛盾。',
    unavailable: '来源未保存：来源显示模块未就绪。',
    projection: '来源未保存：引用无法安全显示，格式或显示长度超限。',
    unrecognized: '来源未保存：新增引用处于代码或其他不可识别的格式中。',
    foreignInline: '来源未保存：正文中的引用不属于本字段的已核验来源。',
    invalidInput: '来源未保存：来源信息无法安全读取。'
  });
  const WARNINGS = LITERATURE_NOTE_SOURCE_STORAGE_WARNINGS;
  function ownValue(object, key) {
    if (!object || typeof object !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return undefined;
    if (!Object.hasOwn(descriptor, 'value')) throw new Error('ACCESSOR_INPUT');
    return descriptor.value;
  }
  function output(value, sourcesSaved, warning = '') {
    return Object.freeze({ value, sourcesSaved, warning });
  }
  function prepareLiteratureNoteHtmlSources(input = {}) {
    let value;
    try {
      value = ownValue(input, 'value');
      const refuse = warning => output(value, false, warning);
      if (typeof value !== 'string' || !value.trim()) return refuse(WARNINGS.invalidValue);
      if (value.length > LIMITS.maxValueLength) return refuse(WARNINGS.tooLong);
      const rawIds = ownValue(input, 'sourceIds');
      const policy = typeof noteTools.literatureNoteRequestPolicy === 'function'
        ? noteTools.literatureNoteRequestPolicy(ownValue(input, 'template'), {
          noteEvidencePolicy: ownValue(input, 'noteEvidencePolicy')
        }) : null;
      let sourceLimit = policy?.id ? policy.maxSources : LIMITS.maxSourceIds;
      if (!Array.isArray(rawIds) || !rawIds.length) return refuse(WARNINGS.noSources);
      if (rawIds.length > LIMITS.maxInputSourceIds) return refuse(WARNINGS.limit);
      const sourceIds = [];
      const selected = new Set();
      for (let index = 0; index < rawIds.length; index += 1) {
        const id = ownValue(rawIds, index);
        if (typeof id !== 'string' || !CURRENT_ID.test(id)) return refuse(WARNINGS.invalidIds);
        if (!selected.has(id)) { selected.add(id); sourceIds.push(id); }
      }
      const documentHash = ownValue(input, 'documentHash');
      const receipt = ownValue(input, 'receipt');
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return refuse(WARNINGS.missingReceipt);
      if (typeof documentHash !== 'string' || !documentHash.trim() ||
          ownValue(receipt, 'documentHash') !== documentHash) return refuse(WARNINGS.wrongDocument);
      if (policy?.id && ownValue(receipt, 'noteEvidencePolicyId') !== policy.id) return refuse(WARNINGS.missingReceipt);
      const records = ownValue(receipt, 'records');
      if (!Array.isArray(records) || !records.length) return refuse(WARNINGS.missingReceipt);
      if (records.length > LIMITS.maxReceiptRecords) return refuse(WARNINGS.limit);
      const rawBudget = ownValue(receipt, 'noteSourceBudget');
      if (rawBudget !== undefined) {
        const boundRecords = records.map(record => ({
          paragraphId: ownValue(record, 'paragraphId'),
          documentHash: ownValue(record, 'documentHash') ?? documentHash
        }));
        const budget = noteTools.getLiteratureNoteSourceBudget?.(ownValue(input, 'template'), {
          sourceKind: 'html-canonical', documentHash,
          signature: ownValue(receipt, 'evidenceSignature'), records: boundRecords
        }, { noteEvidencePolicy: ownValue(input, 'noteEvidencePolicy') });
        const budgetIds = ownValue(rawBudget, 'sourceIds');
        if (!budget || !['version', 'documentHash', 'evidenceSignature', 'maxSources']
          .every(key => ownValue(rawBudget, key) === budget[key]) || !Array.isArray(budgetIds) ||
            budgetIds.length !== budget.sourceIds.length || budget.sourceIds.some((id, i) =>
              ownValue(budgetIds, i) !== id)) return refuse(WARNINGS.missingReceipt);
        sourceLimit = budget.maxSources;
      }
      if (sourceIds.length > sourceLimit) return refuse(WARNINGS.limit);
      const matches = new Map(sourceIds.map(id => [id, 0]));
      for (let index = 0; index < records.length; index += 1) {
        const paragraphId = ownValue(ownValue(records, index), 'paragraphId');
        if (!selected.has(paragraphId)) continue;
        const count = matches.get(paragraphId) + 1;
        if (count > 1) return refuse(WARNINGS.ambiguousRecord);
        matches.set(paragraphId, count);
      }
      if (sourceIds.some(id => matches.get(id) !== 1)) return refuse(WARNINGS.missingRecord);
      const project = currentShared()?.projectLiteratureNoteSources || sourceTools.projectLiteratureNoteSources;
      if (typeof project !== 'function') return refuse(WARNINGS.unavailable);
      const existing = project(value);
      if (!existing?.ok || !Array.isArray(existing.references)) return refuse(WARNINGS.projection);
      const alreadySaved = new Set(existing.references.flatMap(ref => ref.sourceIds));
      if ([...alreadySaved].some(id => !selected.has(id))) return refuse(WARNINGS.foreignInline);
      if (sourceIds.every(id => alreadySaved.has(id))) return output(value, true);

      // The field has already passed the main generation receiver. This step only
      // retains its receipt-bound source IDs in the existing canonical string.
      const missingIds = sourceIds.filter(id => !alreadySaved.has(id));
      const groups = [];
      for (let index = 0; index < missingIds.length; index += LIMITS.maxSourceIds) {
        const ids = missingIds.slice(index, index + LIMITS.maxSourceIds);
        groups.push({ ids, text: `（${ids.join('、')}）` });
      }
      // A field-wide legacy source union does not locate its supporting claims.
      // Preserve it in a separate labelled paragraph, never on the last claim.
      const appendix = `\n\n${LITERATURE_NOTE_FIELD_SOURCE_LABEL}\n`;
      const candidate = `${value}${appendix}${groups.map(group => group.text).join('\n')}`;
      if (candidate.length > LIMITS.maxValueLength) return refuse(WARNINGS.tooLong);
      const projected = project(candidate);
      if (!projected?.ok || !Array.isArray(projected.references)) return refuse(WARNINGS.projection);
      let start = value.length + appendix.length;
      for (const group of groups) {
        const end = start + group.text.length;
        const appended = projected.references.filter(ref => ref.canonicalStart === start &&
          ref.canonicalEnd === end && ref.raw === group.text);
        if (appended.length !== 1 || appended[0].sourceIds.length !== group.ids.length ||
            appended[0].sourceIds.some((id, index) => id !== group.ids[index])) return refuse(WARNINGS.unrecognized);
        start = end + 1;
      }
      return output(candidate, true);
    } catch (_) {
      return output(value, false, WARNINGS.invalidInput);
    }
  }
  function prepareLiteratureNoteSaveValues({ normalized, template, noteEvidencePolicy, sourceKind, documentHash, evidenceReceipt }) {
    const values = Object.create(null);
    for (const field of template.fields) {
      if (!Object.hasOwn(normalized.statuses, field.id)) continue;
      const value = String(normalized.values[field.id] || '');
      if (sourceKind === 'pdf-semantic' || normalized.statuses[field.id] !== 'supported') {
        values[field.id] = value; continue;
      }
      const prepared = prepareLiteratureNoteHtmlSources({ value, sourceIds: normalized.sources[field.id],
        template, noteEvidencePolicy, documentHash, receipt: evidenceReceipt });
      if (evidenceReceipt?.noteSourceBudget && !prepared.sourcesSaved) {
        throw Object.assign(new Error('Literature note field sources cannot be saved within their bounds'),
          { code: 'INVALID_RESPONSE' });
      }
      values[field.id] = prepared.value;
    }
    return values;
  }
  return { LITERATURE_NOTE_SOURCE_STORAGE_LIMITS, LITERATURE_NOTE_SOURCE_STORAGE_WARNINGS,
    LITERATURE_NOTE_FIELD_SOURCE_LABEL,
    prepareLiteratureNoteHtmlSources, prepareLiteratureNoteSaveValues };
});
