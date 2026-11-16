(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const STAGES = ['expected', 'requested', 'returned', 'validated', 'committed', 'reopened'];
  const BINDING_FIELDS = ['documentHash', 'sourceRevision', 'figureId', 'figureScope',
    'inventoryRevision', 'imageDigest', 'semanticContextDigest', 'inputHash',
    'workspaceLifecycle', 'stagingRevision'];

  function descriptor(value, key) {
    if (!value || typeof value !== 'object') return undefined;
    try { return Object.getOwnPropertyDescriptor(value, key); }
    catch (_) { return undefined; }
  }

  function ownData(value, key) {
    const property = descriptor(value, key);
    return property && Object.hasOwn(property, 'value') ? property.value : undefined;
  }

  function identifier(value, maximum) {
    return typeof value === 'string' && value.length <= maximum &&
      /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
  }

  function revision(value) {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : identifier(value, 128);
  }

  function bindingValue(key, value) {
    if (['documentHash', 'imageDigest', 'semanticContextDigest'].includes(key)) {
      if (key !== 'documentHash' && value === '') return '';
      return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
    }
    if (['sourceRevision', 'inventoryRevision'].includes(key)) return revision(value);
    if (key === 'figureId') return identifier(value, 160);
    if (key === 'figureScope') {
      return ['main', 'supplemental', 'extended-data'].includes(value) ? value : null;
    }
    if (key === 'inputHash') return identifier(value, 256);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function projectBinding(value) {
    return Object.fromEntries(BINDING_FIELDS.map(key => [key, bindingValue(key, ownData(value, key))]));
  }

  // A difference report is diagnostic data, never permission to bypass a guard.
  // In particular, two unknown identities do not become an equality proof.
  function compareFigureStageBindings(before, after) {
    const changedFields = [], unavailableFields = [];
    for (const key of BINDING_FIELDS) {
      if (!descriptor(before, key) && !descriptor(after, key)) continue;
      const left = bindingValue(key, ownData(before, key));
      const right = bindingValue(key, ownData(after, key));
      if (left !== right) changedFields.push(key);
      if (left === null || right === null) unavailableFields.push(key);
    }
    return { changedFields, unavailableFields };
  }

  function observePanels(value) {
    if (!Array.isArray(value)) return { panels: null, duplicatePanels: [],
      invalidPanelCount: value === undefined ? 0 : 1, observedPanelCount: null, truncated: false };
    const length = ownData(value, 'length');
    if (!Number.isSafeInteger(length) || length < 0) return observePanels(null);
    const panels = [], duplicatePanels = [];
    let invalidPanelCount = 0;
    for (let index = 0; index < Math.min(length, 30); index += 1) {
      const raw = ownData(value, index);
      const label = typeof raw === 'string' && raw.length <= 64
        ? raw.normalize('NFKC').trim().toUpperCase() : '';
      if (!/^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(label)) { invalidPanelCount += 1; continue; }
      if (!panels.includes(label)) panels.push(label);
      else if (!duplicatePanels.includes(label)) duplicatePanels.push(label);
    }
    return { panels, duplicatePanels, invalidPanelCount,
      observedPanelCount: length, truncated: length > 30 };
  }

  // This module owns no task state, receipts, logging or retries. Runtime callers
  // supply observed sets at each boundary and retain their existing commit guards.
  function createFigurePanelStageDiagnostic(input = {}) {
    const stage = ownData(input, 'stage');
    const depth = ownData(input, 'analysisDepth');
    const sequence = ownData(input, 'sequence');
    const outcome = ownData(input, 'outcome');
    const fields = ownData(input, 'changedFields');
    const changedFields = [];
    if (Array.isArray(fields)) {
      for (let index = 0; index < Math.min(ownData(fields, 'length') || 0, BINDING_FIELDS.length); index += 1) {
        const field = ownData(fields, index);
        if (BINDING_FIELDS.includes(field) && !changedFields.includes(field)) changedFields.push(field);
      }
    }
    return { version: 1, stage: STAGES.includes(stage) ? stage : 'unknown',
      operationId: identifier(ownData(input, 'operationId'), 160),
      figureId: identifier(ownData(input, 'figureId'), 160),
      analysisDepth: ['standard', 'deep'].includes(depth) ? depth : null,
      sequence: Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null,
      ...observePanels(ownData(input, 'panels')),
      binding: projectBinding(ownData(input, 'binding')),
      guard: identifier(ownData(input, 'guard'), 80), changedFields,
      outcome: ['observed', 'candidate', 'committed', 'rejected', 'unknown'].includes(outcome)
        ? outcome : 'unknown' };
  }

  return { createFigurePanelStageDiagnostic, compareFigureStageBindings };
});
