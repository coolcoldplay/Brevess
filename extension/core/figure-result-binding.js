(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEPTHS = ['standard', 'deep'];

  function ownData(value, key) {
    if (!value || typeof value !== 'object') return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    } catch {
      return undefined;
    }
  }

  function inputHash(value) {
    return typeof value === 'string' && value.length <= 256 && value === value.trim()
      ? value : '';
  }

  function hasResult(state, depth) {
    const result = ownData(state, depth) || ownData(state,
      depth === 'deep' ? 'modelDeep' : 'modelStandard');
    return Boolean(result && typeof result === 'object' && !Array.isArray(result));
  }

  // Capture this before changing the request's figureInputHash. A legacy shared
  // hash may migrate only once; an explicit empty binding must remain unknown.
  function captureFigureResultInputHashes(state = {}) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return { standard: '', deep: '' };
    }
    const hasBindings = Object.hasOwn(state, 'figureResultInputHashes');
    const stored = ownData(state, 'figureResultInputHashes');
    const legacyHash = hasBindings ? '' : inputHash(ownData(state, 'figureInputHash'));
    return Object.fromEntries(DEPTHS.map(depth => [depth, hasResult(state, depth)
      ? (hasBindings ? inputHash(ownData(stored, depth))
        : ownData(state, `${depth}Error`) ? '' : legacyHash) : '']));
  }

  function figureResultMatchesInput(state, depth, expectedInputHash) {
    const expected = inputHash(expectedInputHash);
    return DEPTHS.includes(depth) && Boolean(expected) &&
      captureFigureResultInputHashes(state)[depth] === expected;
  }

  // Call only after a successful result commit. This is a pure projection so a
  // failed request cannot rebind old results and the other depth remains intact.
  function bindFigureResultInput(state, depth, expectedInputHash) {
    const expected = inputHash(expectedInputHash);
    if (!DEPTHS.includes(depth) || !expected) {
      const error = new Error('A committed Figure result requires its depth and input hash');
      error.code = 'FIGURE_RESULT_BINDING_INVALID';
      throw error;
    }
    return { ...captureFigureResultInputHashes(state), [depth]: expected };
  }

  function normalizeFigureReusePolicySignature(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : '';
  }

  // Policy is independent of scientific evidence. Legacy results have no
  // policy binding; never stamp them with the currently selected settings.
  function captureFigureResultPolicySignatures(state = {}) {
    const stored = ownData(state, 'figureResultPolicySignatures');
    return Object.fromEntries(DEPTHS.map(depth => [depth, hasResult(state, depth)
      ? normalizeFigureReusePolicySignature(ownData(stored, depth)) : '']));
  }

  function figureResultMatchesPolicy(state, depth, expectedSignature) {
    const expected = normalizeFigureReusePolicySignature(expectedSignature);
    return DEPTHS.includes(depth) && Boolean(expected) &&
      captureFigureResultPolicySignatures(state)[depth] === expected;
  }

  // Successful commits alone call this. An older backend's absent field leaves
  // the new result unknown, while the other depth and user edits stay intact.
  function bindFigureResultPolicy(state, depth, signature) {
    if (!DEPTHS.includes(depth)) {
      const error = new Error('A committed Figure policy requires its depth');
      error.code = 'FIGURE_RESULT_BINDING_INVALID';
      throw error;
    }
    return { ...captureFigureResultPolicySignatures(state),
      [depth]: normalizeFigureReusePolicySignature(signature) };
  }

  function figureResultPolicySignaturesForResults(results, ...sources) {
    return Object.fromEntries(DEPTHS.map(depth => {
      const selected = ownData(results, depth);
      const source = selected && sources.find(item => selected === ownData(item, depth) ||
        selected === ownData(item, depth === 'deep' ? 'modelDeep' : 'modelStandard'));
      return [depth, captureFigureResultPolicySignatures(source)[depth]];
    }));
  }

  function panelArray(value, maximum = 30) {
    try {
      if (!Array.isArray(value)) return null;
      const length = ownData(value, 'length');
      if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
      const items = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
        items.push(descriptor.value);
      }
      return items;
    } catch {
      return null;
    }
  }

  function panelLabel(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.normalize('NFKC').trim().toUpperCase();
    return /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(normalized) ? normalized : '';
  }

  function inventoryBinding(value) {
    const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const revision = value => Number.isSafeInteger(value) && value >= 0 ? String(value)
      : typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : '';
    const documentHash = ownData(value, 'documentHash');
    const sourceRevision = revision(ownData(value, 'sourceRevision'));
    const figureId = ownData(value, 'figureId');
    const figureScope = ownData(value, 'figureScope');
    const inventoryRevision = revision(ownData(value, 'inventoryRevision'));
    const imageDigest = ownData(value, 'imageDigest');
    const semanticContextDigest = ownData(value, 'semanticContextDigest');
    if (!hash(documentHash) || !sourceRevision || !inventoryRevision ||
        typeof figureId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(figureId) ||
        !['main', 'supplemental', 'extended-data'].includes(figureScope) ||
        !(imageDigest === '' || hash(imageDigest)) ||
        !(semanticContextDigest === '' || hash(semanticContextDigest))) return null;
    return { documentHash, sourceRevision, figureId, figureScope,
      inventoryRevision, imageDigest, semanticContextDigest };
  }

  // This projection compares an independently supplied current binding. It does
  // not authenticate provider evidence or turn a model result into a directory.
  // Runtime callers must first verify and commit the inventory before freezing
  // the analysis scope. No input hash, result, receipt or user draft is changed.
  function resolveFigurePanelInventory(figure = {}) {
    const native = panelArray(ownData(figure, 'panelHints'));
    const panelHints = (native || []).map(panelLabel);
    const fallback = reasonCode => ({ panelHints: panelHints.filter(Boolean),
      inventoryMatched: false, coverageComplete: null, binding: null, reasonCode });
    const inventory = ownData(figure, 'effectivePanelInventory');
    if (inventory === undefined || inventory === null) return fallback('');
    if (!native || panelHints.some(panel => !panel) || new Set(panelHints).size !== panelHints.length ||
        ownData(inventory, 'version') !== 1 || typeof ownData(inventory, 'coverageComplete') !== 'boolean') {
      return fallback('FIGURE_PANEL_INVENTORY_INVALID');
    }
    const current = inventoryBinding(ownData(figure, 'panelInventoryBinding'));
    const supplied = inventoryBinding(ownData(inventory, 'binding'));
    if (!current || !supplied || current.figureId !== ownData(figure, 'figureId') ||
        ownData(figure, 'sourceMismatch') === true ||
        (ownData(figure, 'documentHash') !== undefined && ownData(figure, 'documentHash') !== current.documentHash) ||
        (typeof ownData(figure, 'isSupplemental') === 'boolean' &&
          ownData(figure, 'isSupplemental') !== (current.figureScope !== 'main')) ||
        Object.keys(current).some(key => current[key] !== supplied[key])) {
      return fallback('FIGURE_PANEL_INVENTORY_BINDING_MISMATCH');
    }
    const entries = panelArray(ownData(inventory, 'entries'));
    if (!entries) return fallback('FIGURE_PANEL_INVENTORY_INVALID');
    const seen = new Set();
    let candidateCount = 0;
    const confirmed = [];
    for (const entry of entries) {
      const panel = panelLabel(ownData(entry, 'panelId'));
      const source = ownData(entry, 'source');
      const status = ownData(entry, 'status');
      const pages = panelArray(ownData(entry, 'pageNumbers'), 64);
      if (!panel || seen.has(panel) || !['native', 'caption', 'visual', 'manual'].includes(source) ||
          !['confirmed', 'candidate'].includes(status) || !pages ||
          pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > 100000) ||
          (source === 'visual' && (!current.imageDigest || !current.semanticContextDigest || !pages.length))) {
        return fallback('FIGURE_PANEL_INVENTORY_INVALID');
      }
      seen.add(panel);
      if (status === 'confirmed') confirmed.push(panel);
      else candidateCount += 1;
    }
    const effective = [...panelHints];
    for (const panel of confirmed) if (!effective.includes(panel)) effective.push(panel);
    if (effective.length > 30) return fallback('FIGURE_PANEL_INVENTORY_INVALID');
    return { panelHints: effective, inventoryMatched: true,
      coverageComplete: ownData(inventory, 'coverageComplete') === true &&
        confirmed.length > 0 && candidateCount === 0,
      binding: current, reasonCode: '' };
  }

  // Coverage is a read-only projection, never a cache/input binding. The caller
  // must explicitly supply a current independent directory (live extraction or
  // a verified PDF inventory). Restored results and their own saved expected
  // labels cannot certify that all source Panels have been discovered.
  function summarizeFigurePanelCoverage(result, figure, options = {}) {
    const values = panelArray;
    const label = value => {
      if (typeof value !== 'string') return '';
      const normalized = value.normalize('NFKC').trim().toUpperCase();
      return /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(normalized) ? normalized : '';
    };
    const inventory = resolveFigurePanelInventory(figure);
    const rawExpected = values(inventory.inventoryMatched ? inventory.panelHints : ownData(figure, 'panelHints'));
    const expected = rawExpected?.map(label) || [];
    const inventoryKnown = ownData(options, 'inventoryTrusted') === true &&
      expected.length > 0 && expected.every(Boolean) && new Set(expected).size === expected.length;
    const expectedPanels = inventoryKnown ? expected : [];
    const rawPanels = values(ownData(result, 'panels')) || [];
    const returnedPanels = [], duplicatePanels = [], unresolved = new Set();
    let invalidPanelCount = 0;
    for (const panel of rawPanels) {
      const id = label(ownData(panel, 'panel'));
      if (!id) { invalidPanelCount += 1; continue; }
      if (returnedPanels.includes(id)) {
        if (!duplicatePanels.includes(id)) duplicatePanels.push(id);
      } else returnedPanels.push(id);
      if (['not_identifiable', 'unresolved'].includes(ownData(panel, 'status'))) unresolved.add(id);
    }
    for (const list of [ownData(result, 'unresolvedPanels'),
      ownData(ownData(result, 'panelCoverage'), 'unresolvedPanels')]) {
      for (const item of values(list) || []) {
        const id = label(item);
        if (id && returnedPanels.includes(id)) unresolved.add(id);
      }
    }
    const unresolvedPanels = returnedPanels.filter(id => unresolved.has(id));
    const resolvedPanels = returnedPanels.filter(id => !unresolved.has(id));
    const missingPanels = expectedPanels.filter(id => !returnedPanels.includes(id));
    const unexpectedPanels = inventoryKnown
      ? returnedPanels.filter(id => !expectedPanels.includes(id)) : [];
    const analysisCoverageComplete = inventoryKnown && missingPanels.length === 0 &&
      unresolvedPanels.length === 0 && unexpectedPanels.length === 0 &&
      duplicatePanels.length === 0 && invalidPanelCount === 0;
    const complete = analysisCoverageComplete &&
      (!inventory.inventoryMatched || inventory.coverageComplete === true);
    return { inventoryKnown, status: !inventoryKnown ? 'unknown' : complete ? 'complete' : 'partial',
      expectedPanels, returnedPanels, resolvedPanels, unresolvedPanels, missingPanels,
      unexpectedPanels, duplicatePanels, invalidPanelCount,
      inventoryCoverageComplete: inventory.coverageComplete, analysisCoverageComplete };
  }

  return {
    captureFigureResultInputHashes,
    figureResultMatchesInput,
    bindFigureResultInput,
    normalizeFigureReusePolicySignature,
    captureFigureResultPolicySignatures,
    figureResultMatchesPolicy,
    bindFigureResultPolicy,
    figureResultPolicySignaturesForResults,
    resolveFigurePanelInventory,
    summarizeFigurePanelCoverage
  };
});
