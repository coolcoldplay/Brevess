(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PANEL_PATTERN = /^[A-Z0-9][A-Z0-9.+-]{0,7}$/;
  const EVIDENCE_REF_PATTERN = /^(?:caption:(?:shared_legend|panel_[A-Z0-9][A-Z0-9.+-]{0,7})|paragraph:[A-Za-z0-9._:-]{1,120}|image:(?:figure|panel)_[A-Za-z0-9._:-]{1,120})$/;
  const INPUT_MODES = new Set(['figure_image', 'panel_crop', 'caption_context']);
  const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function recoveryError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    for (const [key, value] of Object.entries(details)) {
      error[key] = Array.isArray(value) ? value.slice(0, 30) : value;
    }
    return error;
  }

  function ownDataValue(value, key) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  }

  function isPlainRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_) {
      return false;
    }
  }

  function normalizePanelId(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.normalize('NFKC').trim().toUpperCase();
    return PANEL_PATTERN.test(normalized) ? normalized : '';
  }

  function normalizeLabelList(labels, options = {}) {
    const invalidLabelIndexes = [];
    const duplicatePanels = [];
    const normalized = [];
    const seen = new Set();
    if (!Array.isArray(labels) || labels.length > 30) {
      throw recoveryError(
        options.invalidCode || 'PANEL_RECOVERY_LABELS_INVALID',
        'Panel recovery labels must be a bounded array',
        { invalidLabelIndexes: [] }
      );
    }
    for (let index = 0; index < labels.length; index += 1) {
      if (!Object.hasOwn(labels, index)) {
        invalidLabelIndexes.push(index);
        continue;
      }
      const panel = normalizePanelId(labels[index]);
      if (!panel) {
        invalidLabelIndexes.push(index);
        continue;
      }
      if (seen.has(panel)) {
        if (!duplicatePanels.includes(panel)) duplicatePanels.push(panel);
        continue;
      }
      seen.add(panel);
      normalized.push(panel);
    }
    if (invalidLabelIndexes.length) {
      throw recoveryError(
        options.invalidCode || 'PANEL_RECOVERY_LABELS_INVALID',
        'Panel recovery labels contain invalid entries',
        { invalidLabelIndexes }
      );
    }
    if (duplicatePanels.length) {
      throw recoveryError(
        options.duplicateCode || 'PANEL_RECOVERY_LABELS_DUPLICATED',
        'Panel recovery labels contain normalized duplicates',
        { duplicatePanels }
      );
    }
    return normalized;
  }

  function createPanelRecoveryBatches(missingLabels, maximumBatchSize = 3) {
    if (!Number.isInteger(maximumBatchSize) || maximumBatchSize < 1 || maximumBatchSize > 10) {
      throw recoveryError(
        'PANEL_RECOVERY_BATCH_SIZE_INVALID',
        'Panel recovery batch size must be an integer from 1 to 10'
      );
    }
    const normalized = normalizeLabelList(missingLabels);
    const batches = [];
    for (let index = 0; index < normalized.length; index += maximumBatchSize) {
      batches.push(normalized.slice(index, index + maximumBatchSize));
    }
    return batches;
  }

  function normalizeEvidenceRefs(value) {
    if (!Array.isArray(value)) return [];
    const refs = [];
    for (let index = 0; index < value.length && refs.length < 16; index += 1) {
      if (!Object.hasOwn(value, index) || typeof value[index] !== 'string') continue;
      const ref = value[index].normalize('NFKC').trim();
      if (EVIDENCE_REF_PATTERN.test(ref) && !refs.includes(ref)) refs.push(ref);
    }
    return refs;
  }

  function createUnidentifiedPanelRecord(panelLabel, evidence = {}) {
    const panel = normalizePanelId(panelLabel);
    if (!panel) {
      throw recoveryError(
        'PANEL_RECOVERY_LABELS_INVALID',
        'Unidentified Panel record requires a valid Panel label',
        { invalidLabelIndexes: [0] }
      );
    }
    const inputModeValue = ownDataValue(evidence, 'inputMode');
    const inputMode = INPUT_MODES.has(inputModeValue) ? inputModeValue : 'caption_context';
    return {
      panel,
      status: 'not_identifiable',
      reasonCode: 'insufficient_panel_evidence',
      inputMode,
      evidenceRefs: normalizeEvidenceRefs(ownDataValue(evidence, 'evidenceRefs'))
    };
  }

  function cloneOwnData(value, seen = new Map()) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const clone = [];
      seen.set(value, clone);
      for (let index = 0; index < value.length; index += 1) {
        if (Object.hasOwn(value, index)) clone.push(cloneOwnData(value[index], seen));
      }
      return clone;
    }
    const clone = {};
    seen.set(value, clone);
    for (const key of Object.keys(value)) {
      if (BLOCKED_KEYS.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
      clone[key] = cloneOwnData(descriptor.value, seen);
    }
    return clone;
  }

  function normalizePanelEntries(result, source) {
    const panels = ownDataValue(result, 'panels');
    const invalidPanelIndexes = [];
    const duplicatePanels = [];
    const normalized = [];
    const seen = new Set();
    if (panels === undefined) return normalized;
    if (!Array.isArray(panels) || panels.length > 30) {
      throw recoveryError(
        `PANEL_RECOVERY_${source}_INVALID`,
        'Panel recovery result must contain a bounded own Panel array',
        { invalidPanelIndexes: [] }
      );
    }
    for (let index = 0; index < panels.length; index += 1) {
      if (!Object.hasOwn(panels, index)) {
        invalidPanelIndexes.push(index);
        continue;
      }
      const raw = panels[index];
      if (!isPlainRecord(raw)) {
        invalidPanelIndexes.push(index);
        continue;
      }
      const panelDescriptor = Object.getOwnPropertyDescriptor(raw, 'panel');
      const panelIdDescriptor = Object.getOwnPropertyDescriptor(raw, 'panelId');
      const hasPanel = Boolean(panelDescriptor && Object.hasOwn(panelDescriptor, 'value'));
      const hasPanelId = Boolean(panelIdDescriptor && Object.hasOwn(panelIdDescriptor, 'value'));
      const rawPanel = ownDataValue(raw, 'panel');
      const rawPanelId = ownDataValue(raw, 'panelId');
      const normalizedPanel = hasPanel ? normalizePanelId(rawPanel) : '';
      const normalizedPanelId = hasPanelId ? normalizePanelId(rawPanelId) : '';
      const aliasesConflict = hasPanel && hasPanelId && normalizedPanel !== normalizedPanelId;
      const panel = normalizedPanel || normalizedPanelId;
      if (!panel || aliasesConflict) {
        invalidPanelIndexes.push(index);
        continue;
      }
      if (seen.has(panel)) {
        if (!duplicatePanels.includes(panel)) duplicatePanels.push(panel);
        continue;
      }
      seen.add(panel);
      const clone = cloneOwnData(raw);
      clone.panel = panel;
      delete clone.panelId;
      normalized.push({ panel, record: clone });
    }
    if (invalidPanelIndexes.length) {
      throw recoveryError(
        `PANEL_RECOVERY_${source}_INVALID`,
        'Panel recovery result contains invalid Panel entries',
        { invalidPanelIndexes }
      );
    }
    if (duplicatePanels.length) {
      throw recoveryError(
        `PANEL_RECOVERY_${source}_DUPLICATED`,
        'Panel recovery result contains normalized duplicate Panels',
        { duplicatePanels }
      );
    }
    return normalized;
  }

  function normalizeIdentity(value, key) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_) {
      return { present: true, value: '' };
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      return { present: false, value: '' };
    }
    if (typeof descriptor.value !== 'string') return { present: true, value: '' };
    const maximum = key === 'analysisDepth' ? 40 : 120;
    const normalized = descriptor.value.normalize('NFKC').trim();
    if (!normalized || normalized.length > maximum) return { present: true, value: '' };
    return {
      present: true,
      value: key === 'analysisDepth' ? normalized.toLowerCase() : normalized
    };
  }

  function assertCompatibleResultIdentity(baseResult, recoveryResult) {
    const mismatchedFields = [];
    const invalidIdentityFields = [];
    for (const key of ['figureId', 'figureVersion', 'analysisDepth']) {
      const base = normalizeIdentity(baseResult, key);
      const recovery = normalizeIdentity(recoveryResult, key);
      if ((base.present && !base.value) || (recovery.present && !recovery.value)) {
        invalidIdentityFields.push(key);
      } else if (base.present && recovery.present && base.value !== recovery.value) {
        mismatchedFields.push(key);
      }
    }
    if (invalidIdentityFields.length) {
      throw recoveryError(
        'PANEL_RECOVERY_RESULT_INVALID',
        'Panel recovery result contains invalid identity fields',
        { invalidIdentityFields }
      );
    }
    if (mismatchedFields.length) {
      throw recoveryError(
        'PANEL_RECOVERY_RESULT_IDENTITY_MISMATCH',
        'Panel recovery result identity does not match the base result',
        { mismatchedFields }
      );
    }
  }

  function mergeRecoveredPanels(baseResult, recoveryResult, expectedLabels) {
    if (!isPlainRecord(baseResult) || !isPlainRecord(recoveryResult)) {
      throw recoveryError(
        'PANEL_RECOVERY_RESULT_INVALID',
        'Panel recovery merge requires two result objects'
      );
    }
    assertCompatibleResultIdentity(baseResult, recoveryResult);
    const expectedPanels = normalizeLabelList(expectedLabels, {
      invalidCode: 'PANEL_RECOVERY_EXPECTED_INVALID',
      duplicateCode: 'PANEL_RECOVERY_EXPECTED_DUPLICATED'
    });
    const expectedSet = new Set(expectedPanels);
    const basePanels = normalizePanelEntries(baseResult, 'BASE_PANELS');
    const recoveredPanels = normalizePanelEntries(recoveryResult, 'PANELS');
    const completed = new Set(basePanels.map(item => item.panel));
    const overlapPanels = recoveredPanels
      .map(item => item.panel)
      .filter(panel => completed.has(panel));
    if (overlapPanels.length) {
      throw recoveryError(
        'PANEL_RECOVERY_OVERLAP',
        'Panel recovery response included an already completed Panel',
        { overlapPanels }
      );
    }
    const unexpectedPanels = recoveredPanels
      .map(item => item.panel)
      .filter(panel => !expectedSet.has(panel));
    if (unexpectedPanels.length) {
      throw recoveryError(
        'PANEL_RECOVERY_UNEXPECTED',
        'Panel recovery response included an unexpected Panel',
        { unexpectedPanels }
      );
    }

    const merged = cloneOwnData(baseResult);
    const expectedOrder = new Map(expectedPanels.map((panel, index) => [panel, index]));
    const allPanels = [...basePanels, ...recoveredPanels];
    allPanels.sort((left, right) =>
      (expectedOrder.get(left.panel) ?? Number.MAX_SAFE_INTEGER) -
      (expectedOrder.get(right.panel) ?? Number.MAX_SAFE_INTEGER)
    );
    merged.panels = allPanels.map(item => cloneOwnData(item.record));
    const returnedPanels = allPanels.map(item => item.panel);
    const unresolvedPanels = expectedPanels.filter(panel => !returnedPanels.includes(panel));
    const existingCoverage = ownDataValue(merged, 'panelCoverage');
    merged.panelCoverage = {
      ...(existingCoverage && typeof existingCoverage === 'object'
        ? cloneOwnData(existingCoverage) : {}),
      expectedPanels: expectedPanels.slice(),
      returnedPanels: returnedPanels.slice(),
      missingPanels: unresolvedPanels.slice()
    };
    merged.unresolvedPanels = unresolvedPanels.slice();
    return merged;
  }

  return {
    createPanelRecoveryBatches,
    createUnidentifiedPanelRecord,
    mergeRecoveredPanels
  };
});
