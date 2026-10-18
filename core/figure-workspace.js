(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const evidenceFirstContracts = shared.EVIDENCE_FIRST_VERSIONS &&
    typeof shared.normalizeEvidenceFirstVersions === 'function'
    ? shared
    : (typeof require === 'function' ? require('./evidence-first-mechanism.js') : null);
  if (!evidenceFirstContracts?.EVIDENCE_FIRST_VERSIONS ||
      typeof evidenceFirstContracts.normalizeEvidenceFirstVersions !== 'function') {
    throw new Error('EVIDENCE_FIRST_CONTRACT_UNAVAILABLE');
  }
  const EVIDENCE_FIRST_VERSIONS = evidenceFirstContracts.EVIDENCE_FIRST_VERSIONS;
  const normalizeEvidenceFirstVersions =
    evidenceFirstContracts.normalizeEvidenceFirstVersions;
  const canvasContracts = typeof shared.normalizeMechanismDrawing === 'function'
    ? shared : (typeof require === 'function' ? require('./mechanism-canvas-model.js') : null);
  const resultBindingContracts = typeof shared.resolveFigurePanelInventory === 'function'
    ? shared : (typeof require === 'function' ? require('./figure-result-binding.js') : null);
  const FIGURE_WORKSPACE_DRAFT_VERSION = 7;
  const FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS = 1000000;
  const FIGURE_WORKSPACE_TEXT_BUDGET = 850000;
  const MAX_TEXT_LENGTH = 4000;
  const MAX_ID_LENGTH = 160;
  const MAX_FIGURES = 128;
  const MAX_PANELS_PER_FIGURE = 64;
  const MAX_COLLECTION_ITEMS = 64;
  const MAX_PANEL_IDS_PER_BLOCK = 32;
  const MAX_RESULT_PANEL_GROUPS = 30;
  const MAX_RESULT_ARGUMENT_STEPS = 30;
  const MAX_RESULT_LOGIC_BRIDGES = 8;
  const MAX_NESTED_DEPTH = 4;
  const MAX_TIMESTAMP = 4102444800000;
  const MECHANISM_GENERATION_ENVELOPE_VERSION = 1;
  const MAX_MECHANISM_GENERATION_ENVELOPE_LENGTH = 750000;
  const TRUSTED_GENERATION_SNAPSHOTS = new WeakSet();
  const TRUSTED_FIGURE_WORKSPACE_DRAFTS = new WeakSet();
  const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
  // These words describe password UI/policy prose rather than a supplied
  // credential value. Every other whitespace `password <word>` is redacted.
  const PASSWORD_PROSE_FOLLOWERS = new Set([
    'response', 'field', 'policy', 'reset', 'requirement', 'prompt', 'rule', 'rules',
    'guidance', 'validation', 'manager', 'input', 'form', 'strength', 'change', 'recovery'
  ]);
  // Lowercase `bearer` and spaced credential labels can occur in explanatory
  // prose. Only these immediate followers are retained; all other values are
  // treated as credentials, regardless of entropy.
  const SPACED_CREDENTIAL_PROSE_FOLLOWERS = new Set([
    'transport', 'concentration', 'mechanism', 'response', 'field', 'policy',
    'reset', 'requirement', 'prompt', 'storage', 'handling', 'validation',
    'exchange', 'flow', 'state'
  ]);
  const KNOWN_OPAQUE_URI_SCHEMES = new Set([
    'blob', 'data', 'file', 'ftp', 'ftps', 'geo', 'http', 'https', 'javascript',
    'mailto', 'magnet', 'sms', 'tel', 'urn', 'ws', 'wss'
  ]);
  const MAX_REVISION = 2147483647;
  let activeNormalizationTextBudget = null;
  const PREPARED_FIGURE_WORKSPACE_VIEW_CONTEXT = Symbol(
    'preparedFigureWorkspaceViewContext'
  );
  const ROOT_KEYS = [
    'revision', 'binding', 'meta', 'figures', 'evidenceBlocks', 'supplementalPlacements', 'figureDisplayOrder',
    'mechanismChain', 'mechanismGeneration'
  ];
  const BINDING_KEYS = [
    'documentId', 'documentHash', 'canonicalUrl', 'workspaceId',
    'workspaceGeneration'
  ];
  const EDITABLE_KEYS = ['value', 'humanReviewed', 'editedAt'];
  const OVERVIEW_KEYS = [
    'figureQuestion', 'coreConclusion', 'claimBoundary', 'authorAssembly', 'remainingQuestion'
  ];
  const PANEL_KEYS = [
    'panelId', 'panel', 'id', 'purpose', 'evidenceType', 'directObservation',
    'experimentalMethods', 'statisticalMethods', 'methods', 'comparison', 'note',
    'phenotypeName', 'design', 'localInference', 'contribution', 'provenance', 'observationSource', 'displayName'
  ];
  const FIGURE_KEYS = [
    'figureId', 'id', 'figureLabel', 'label', 'isSupplemental', 'overview', 'panels', 'panelHints',
    'evidenceBlocks', 'evidenceBlockTombstones', 'manualEvidenceArchive',
    'analysisDepth', 'figureQuestion', 'coreConclusion', 'claimBoundary', 'authorAssembly',
    'remainingQuestion'
  ];
  const META_KEYS = [
    'backgroundItems', 'researchBackground', 'scientificQuestions', 'scientificQuestion',
    'innovationPoints', 'limitationPoints', 'researchLogic', 'paperMetaDetails'
  ];
  const SCIENTIFIC_QUESTION_KEYS = [
    'questionId', 'text', 'value', 'relationType', 'parentQuestionIds',
    'supportingFigureIds', 'humanReviewed', 'editedAt'
  ];
  const SCIENTIFIC_QUESTION_RELATIONS = new Set([
    'root', 'progressive', 'parallel', 'branch', 'convergent', 'validation'
  ]);
  const EVIDENCE_BLOCK_KEYS = [
    'id', 'kind', 'sourceType', 'panelIds', 'fromBlockId', 'toBlockId',
    'groupGoal', 'groupConclusion', 'upstreamContext', 'established', 'handoff', 'evidenceLevel',
    'transitionToNext', 'fromGroup', 'toGroup', 'nextGoal', 'relationType',
    'provenance', 'title', 'method', 'observation', 'conclusion',
    'originalSourceType', 'originalPanelIds', 'originalSource', 'displayName'
  ];
  const PLACEMENT_KEYS = ['figureId', 'slot', 'rank'];
  const CHAIN_KEYS = [
    'initialized', 'nodes', 'edges', 'panelAliases', 'reviewTombstones',
    'layoutPreferences', 'generationIssues', 'drawing'
  ];
  const REVIEW_TOMBSTONE_KEYS = ['nodes', 'edges', 'evidence'];
  const NODE_TOMBSTONE_KEYS = ['id', 'editedAt'];
  const EDGE_TOMBSTONE_KEYS = ['id', 'from', 'to', 'editedAt'];
  const EVIDENCE_TOMBSTONE_KEYS = [
    'edgeId', 'from', 'to', 'figureId', 'panelId', 'editedAt'
  ];
  const GENERATION_ISSUE_KEYS = ['code', 'message', 'edgeIndex', 'edgeId', 'displayId'];
  const NODE_KEYS = ['id', 'label'];
  const EDGE_KEYS = [
    'id', 'from', 'to', 'label', 'polarity', 'panelEvidence',
    'humanReviewed', 'editedAt'
  ];
  const PANEL_EVIDENCE_KEYS = [
    'figureId', 'panelId', 'value', 'unresolved', 'evidenceClass', 'evidenceClassSource',
    'humanReviewed', 'editedAt'
  ];
  const PANEL_SCALAR_FIELDS = new Set([
    'purpose', 'evidenceType', 'directObservation', 'comparison', 'note',
    'phenotypeName', 'design', 'localInference', 'contribution'
  ]);
  const PANEL_LIST_FIELDS = new Set(['experimentalMethods', 'statisticalMethods']);
  const EVIDENCE_SCALAR_FIELDS = new Set([
    'groupGoal', 'groupConclusion', 'upstreamContext', 'established', 'handoff', 'evidenceLevel',
    'transitionToNext', 'fromGroup', 'toGroup', 'nextGoal', 'relationType'
  ]);
  const MANUAL_EVIDENCE_FIELDS = new Set(['title', 'method', 'observation', 'conclusion']);
  const MECHANISM_POLARITIES = new Set(['neutral', 'positive', 'negative']);
  const GENERATED_SOURCE_FIELDS = new Set([
    'role', 'evidenceType', 'purpose', 'design', 'comparison',
    'directObservation', 'observationSource', 'experimentalMethods',
    'statisticalMethods', 'remainingQuestion', 'phenotypeName'
  ]);
  const GENERATED_CONTEXT_FIELDS = Object.freeze([
    'species', 'tissue', 'cellType', 'compartment', 'condition', 'timepoint', 'dose'
  ]);
  const GENERATED_NODE_DIALECTS = Object.freeze([
    Object.freeze({
      version: 'node-v2',
      idPattern: /^node-v2-[a-f0-9]{16}$/u,
      nodeTypes: Object.freeze(['entity', 'intervention', 'outcome', 'state'])
    }),
    Object.freeze({
      version: 'node-v1',
      idPattern: /^node-v1-[a-f0-9]{16}$/u,
      nodeTypes: Object.freeze(['entity', 'cell_type', 'phenotype'])
    })
  ]);
  const EDGE_SCALAR_FIELDS = new Set(['from', 'to', 'label', 'polarity']);
  const MUTATION_KEYS = [
    'type', 'expectedRevision', 'figureId', 'panelId', 'field', 'value', 'block', 'blockId',
    'placements', 'node', 'nodeId', 'edge', 'edgeId', 'evidence', 'index', 'target', 'modelValue',
    'expectedFigureId', 'expectedPanelId',
    'chain', 'layoutPreferences', 'backgroundItems', 'scientificQuestions',
    'innovationPoints', 'limitationPoints', 'researchLogic', 'overwriteReviewedEmpty',
    'generationEnvelope', 'mechanismGeneration', 'command', 'createMissingPanels',
    'newBlockId', 'panelIds', 'sourceBlockIds', 'figureIds'
  ];
  const EVIDENCE_RESULT_KEYS = ['panelGroups', 'argumentChain', 'logicBridges'];
  const RESULT_PANEL_GROUP_KEYS = ['panels', 'groupGoal', 'groupConclusion', 'upstreamContext'];
  const RESULT_ARGUMENT_STEP_KEYS = [
    'panels', 'established', 'handoff', 'evidenceLevel'
  ];
  const RESULT_LOGIC_BRIDGE_KEYS = [
    'fromGroup', 'toGroup', 'relationType', 'bridge'
  ];

  function figurePanelDisplayId(figureLabel, isSupplemental, panelId) {
    const label = String(figureLabel || '');
    const supplement =
      /(?:supplement(?:ary|al)\s+(?:figure|fig\.?)?\s*|(?:figure|fig\.?)\s*S|\bS)(\d{1,3})\b/i
        .exec(label) ||
      /(?:Figure\s*)?S(\d+)/i.exec(label);
    const numberedFigure = /(?:figure|fig\.?)\s*(?:S\s*)?(\d{1,3})\b/i.exec(label);
    const number = supplement?.[1] || numberedFigure?.[1] || '';
    const prefix = number
      ? `${isSupplemental === true || supplement ? 'S' : ''}${Number(number)}` : '';
    const panel = String(panelId || '').trim().toUpperCase();
    return formatCompactFigurePanelId(prefix, panel);
  }

  function compactPanelId(figureLabel, panelId) {
    return figurePanelDisplayId(figureLabel, undefined, panelId);
  }

  function formatCompactFigurePanelId(figurePrefix, panelId) {
    const prefix = String(figurePrefix || '').trim().toUpperCase();
    const panel = String(panelId || '').trim().toUpperCase();
    if (!prefix || !panel) return panel || prefix;
    return /^[A-Z]+$/.test(panel) ? `${prefix}${panel}` : `${prefix}·${panel}`;
  }

  function mechanismEvidenceClass(value) {
    const token = boundedText(value, 160).toLowerCase();
    if (!token || /(?:非|不(?:是)?)\s*(?:充分性|必要性)|证据不足/u.test(token) ||
        /\b(?:not\s+sufficient|insufficient|non[-_ ]?sufficient|not\s+necessary|unnecessary|non[-_ ]?necessary)\b/u.test(token)) {
      return 'other';
    }
    if (token === 'red') return 'sufficiency';
    if (token === 'blue') return 'necessity';
    if (token === 'black' || token === 'intervention') return 'other';
    if (/充分性/u.test(token) || /\b(?:sufficiency|sufficient|gain[_ -]?of[_ -]?function|overexpress(?:ion|ed)?)\b/u.test(token)) {
      return 'sufficiency';
    }
    if (/必要性/u.test(token) || /\b(?:necessity|necessary|loss[_ -]?of[_ -]?function|knock(?:out|down)|silenc(?:e|ing|ed))\b/u.test(token)) {
      return 'necessity';
    }
    return 'other';
  }

  function explicitMechanismEvidenceClass(value) {
    if (typeof value !== 'string') return '';
    const token = value.trim().toLowerCase();
    if (token === 'red') return 'sufficiency';
    if (token === 'blue') return 'necessity';
    if (token === 'black' || token === 'intervention') return 'other';
    return token === 'sufficiency' || token === 'necessity' || token === 'other'
      ? token : '';
  }

  function explicitMechanismEvidenceClassSource(value) {
    if (typeof value !== 'string') return '';
    const token = value.trim().toLowerCase();
    return token === 'inferred' || token === 'manual' ? token : '';
  }

  function mechanismCompactPanelId(figure, figureLabel, panelId) {
    return figurePanelDisplayId(figureLabel, figure.isSupplemental, panelId);
  }

  function mechanismFigureAnalysis(rawFigure) {
    const figure = ownRecord(rawFigure, [
      'activeDepth', 'deep', 'standard', 'analysis', 'result'
    ]);
    const preferred = figure.activeDepth === 'standard'
      ? figure.standard : (figure.deep || figure.standard);
    return isPlainObject(preferred) ? preferred
      : isPlainObject(figure.analysis) ? figure.analysis
        : isPlainObject(figure.result) ? figure.result : {};
  }

  function mechanismPanelReference(value) {
    const canonical = mechanismCanonicalPanelReference(value);
    if (canonical) return canonical;
    const text = boundedText(value, 80).toUpperCase();
    const wordForm = /^(SUPPLEMENT(?:ARY|AL)?\s+)?(?:FIGURE|FIG\.?)\s*(S\s*)?0*(\d{1,3})\s+(?:PANEL\s+)?([A-Z][A-Z0-9_-]*)$/u.exec(text);
    if (wordForm) {
      const prefix = wordForm[1] || wordForm[2] ? 'S' : '';
      return formatCompactFigurePanelId(`${prefix}${Number(wordForm[3])}`, wordForm[4]);
    }
    const match = /^(S?)0*(\d{1,3})(?:·)?([A-Z][A-Z0-9_-]*)$/u.exec(text);
    if (!match) return '';
    return formatCompactFigurePanelId(`${match[1]}${Number(match[2])}`, match[3]);
  }

  function mechanismCanonicalPanelReference(value) {
    if (typeof value !== 'string' || value.length > MAX_ID_LENGTH + 33) return '';
    const separator = value.lastIndexOf(':');
    if (separator <= 0 || value.indexOf(':') !== separator) return '';
    const figureId = safeId(value.slice(0, separator));
    const panelId = safePanelId(value.slice(separator + 1));
    const canonical = figureId && panelId ? `${figureId}:${panelId}` : '';
    return canonical === value ? canonical : '';
  }

  function mechanismPanelKey(figureId, panelId) {
    const safeFigureId = safeId(figureId, MAX_ID_LENGTH);
    const safePanel = safePanelId(panelId);
    return safeFigureId && safePanel ? `${safeFigureId}:${safePanel}` : '';
  }

  function resolvePanelKey(figures, value) {
    if (typeof value !== 'string' || value.length > MAX_ID_LENGTH + 33) return null;
    const separator = value.lastIndexOf(':');
    if (separator <= 0) return null;
    const figureId = safeId(value.slice(0, separator), MAX_ID_LENGTH);
    const panelId = safePanelId(value.slice(separator + 1));
    const panelKey = mechanismPanelKey(figureId, panelId);
    if (!panelKey || panelKey !== value || !Object.hasOwn(figures, figureId) ||
        !Object.hasOwn(figures[figureId].panels, panelId)) return null;
    return { figureId, panelId, panelKey };
  }

  function mechanismPanelEvidenceCatalog(rawFigures) {
    const byDisplay = new Map();
    const entries = [];
    for (const rawFigure of cappedArrayValues(rawFigures, MAX_FIGURES)) {
      if (!isPlainObject(rawFigure)) continue;
      const figure = ownRecord(rawFigure, [
        'figureId', 'id', 'figureLabel', 'label', 'isSupplemental',
        'panelHints', 'panelAnalyses'
      ]);
      const figureId = safeId(figure.figureId || figure.id);
      const figureLabel = boundedText(figure.figureLabel || figure.label, 240);
      if (!figureId || !figureLabel) continue;
      const analysis = mechanismFigureAnalysis(rawFigure);
      const analysisRecord = ownRecord(analysis, [
        'panels', 'argumentChain', 'evidenceRelations'
      ]);
      const evidenceByPanel = new Map();
      const register = (rawPanelId, rawClass = '') => {
        const panelId = safePanelId(rawPanelId);
        if (!panelId) return;
        const evidenceClass = mechanismEvidenceClass(rawClass);
        const current = evidenceByPanel.get(panelId) || 'other';
        const rank = { other: 0, necessity: 1, sufficiency: 2 };
        if (!evidenceByPanel.has(panelId) || rank[evidenceClass] > rank[current]) {
          evidenceByPanel.set(panelId, evidenceClass);
        }
      };
      for (const rawHint of cappedArrayValues(figure.panelHints, MAX_PANELS_PER_FIGURE)) {
        const hint = ownRecord(rawHint, ['panelId', 'panel', 'id']);
        register(isPlainObject(rawHint)
          ? hint.panelId || hint.panel || hint.id : rawHint);
      }
      for (const [fallbackPanelId, rawPanel] of cappedMapEntries(
        figure.panelAnalyses, MAX_PANELS_PER_FIGURE
      )) {
        const panel = ownRecord(rawPanel, [
          'panelId', 'panel', 'id', 'role', 'evidenceType'
        ]);
        register(
          panel.panelId || panel.panel || panel.id || fallbackPanelId,
          panel.role || panel.evidenceType
        );
      }
      for (const rawPanel of cappedArrayValues(analysisRecord.panels, MAX_PANELS_PER_FIGURE)) {
        const panel = ownRecord(rawPanel, ['panelId', 'panel', 'id', 'role', 'evidenceType']);
        register(panel.panelId || panel.panel || panel.id, panel.role || panel.evidenceType);
      }
      for (const rawStep of cappedArrayValues(
        analysisRecord.argumentChain, MAX_RESULT_ARGUMENT_STEPS
      )) {
        const step = ownRecord(rawStep, ['panels', 'evidenceLevel', 'evidence_level']);
        for (const panelId of cappedArrayValues(step.panels, MAX_PANEL_IDS_PER_BLOCK)) {
          register(panelId, step.evidenceLevel || step.evidence_level);
        }
      }
      for (const rawRelation of cappedArrayValues(
        analysisRecord.evidenceRelations, MAX_COLLECTION_ITEMS
      )) {
        const relation = ownRecord(rawRelation, ['panels', 'relationLevel', 'relation_level']);
        for (const panelId of cappedArrayValues(relation.panels, MAX_PANEL_IDS_PER_BLOCK)) {
          register(panelId, relation.relationLevel || relation.relation_level);
        }
      }
      for (const [panelId, evidenceClass] of evidenceByPanel) {
        const displayId = mechanismCompactPanelId(figure, figureLabel, panelId);
        const entry = { figureId, panelId, displayId, evidenceClass };
        entries.push(entry);
        if (!displayId) continue;
        const displayEntries = byDisplay.get(displayId) || [];
        displayEntries.push(entry);
        byDisplay.set(displayId, displayEntries);
      }
    }
    return { byDisplay, entries };
  }

  function mechanismPanelEvidenceOptions(rawFigures) {
    return mechanismPanelEvidenceCatalog(rawFigures).entries
      .map(entry => ({ ...entry }))
      .sort((left, right) => left.displayId.localeCompare(
        right.displayId, undefined, { numeric: true, sensitivity: 'base' }
      ) || left.figureId.localeCompare(right.figureId) ||
        left.panelId.localeCompare(right.panelId))
      .slice(0, MAX_FIGURES * MAX_PANELS_PER_FIGURE);
  }

  function resolveMechanismPanelEvidenceReference(rawReference, rawFigures) {
    const reference = mechanismPanelReference(rawReference);
    if (!reference) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const options = mechanismPanelEvidenceOptions(rawFigures);
    const canonical = mechanismCanonicalPanelReference(reference);
    const matches = canonical ? options.filter(option =>
      `${option.figureId}:${option.panelId}` === canonical) : options.filter(option =>
      option.displayId === reference);
    if (!matches.length) throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
    if (matches.length !== 1) {
      throw workspaceError('FIGURE_WORKSPACE_PANEL_REFERENCE_AMBIGUOUS');
    }
    return { ...matches[0] };
  }

  function strictAuditTimestamp(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) &&
      value >= 0 && value <= MAX_TIMESTAMP;
  }

  function strictAuditText(value, maximum, allowEmpty = true) {
    return typeof value === 'string' && value.length <= maximum &&
      (allowEmpty || Boolean(value)) && boundedText(value, maximum) === value;
  }

  function strictAuditCloneable(value, allowedKeys) {
    let keys;
    try { keys = Reflect.ownKeys(value); } catch (_) { return false; }
    const allowed = new Set(allowedKeys);
    for (const key of keys) {
      if (typeof key !== 'string' || !allowed.has(key)) return false;
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { return false; }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    }
    let clone;
    try { clone = globalThis.structuredClone; } catch (_) { return false; }
    if (typeof clone !== 'function') return false;
    try { clone(value); } catch (_) { return false; }
    return true;
  }

  function strictAuditCloneableArray(value, length) {
    const allowedKeys = ['length'];
    for (let index = 0; index < length; index += 1) allowedKeys.push(String(index));
    return strictAuditCloneable(value, allowedKeys);
  }

  function strictAuditEditable(value, nodeLabel = false) {
    const editable = strictOwnDataRecord(value, EDITABLE_KEYS);
    if (!editable || !(nodeLabel ? isCanonicalMechanismWorkspaceNodeLabel(editable.value) : strictAuditText(editable.value, MAX_TEXT_LENGTH)) ||
        typeof editable.humanReviewed !== 'boolean' ||
        !strictAuditTimestamp(editable.editedAt) ||
        !strictAuditCloneable(value, EDITABLE_KEYS)) return null;
    return {
      value: editable.value,
      humanReviewed: editable.humanReviewed,
      editedAt: editable.editedAt
    };
  }

  function strictAuditPanelEvidence(value, allowUnresolved = false) {
    const evidence = strictOwnDataRecord(value, [
      'figureId', 'panelId', 'value', 'unresolved', 'humanReviewed', 'editedAt'
    ], ['evidenceClass', 'evidenceClassSource']);
    if (!evidence || typeof evidence.figureId !== 'string' ||
        safeId(evidence.figureId) !== evidence.figureId ||
        typeof evidence.panelId !== 'string' ||
        safePanelId(evidence.panelId) !== evidence.panelId ||
        !strictAuditText(evidence.value, MAX_TEXT_LENGTH) ||
        typeof evidence.unresolved !== 'boolean' ||
        (!allowUnresolved && evidence.unresolved === true) ||
        (evidence.unresolved === true && (evidence.figureId || evidence.panelId)) ||
        (evidence.unresolved === false && (!evidence.figureId || !evidence.panelId)) ||
        typeof evidence.humanReviewed !== 'boolean' ||
        !strictAuditTimestamp(evidence.editedAt)) return null;
    if (Object.hasOwn(evidence, 'evidenceClass') &&
        explicitMechanismEvidenceClass(evidence.evidenceClass) !== evidence.evidenceClass) {
      return null;
    }
    if (Object.hasOwn(evidence, 'evidenceClassSource') &&
        explicitMechanismEvidenceClassSource(evidence.evidenceClassSource) !==
          evidence.evidenceClassSource) return null;
    if (!strictAuditCloneable(value, PANEL_EVIDENCE_KEYS)) return null;
    return { ...evidence };
  }

  function strictGeneratedAuditNode(value) {
    const node = strictOwnDataRecord(value, NODE_KEYS);
    const label = node && strictAuditEditable(node.label, true);
    return Boolean(node && typeof node.id === 'string' &&
      safeId(node.id, 80) === node.id && label &&
      strictAuditCloneable(value, NODE_KEYS));
  }

  function strictReviewedAuditNode(value) {
    const node = strictOwnDataRecord(value, NODE_KEYS);
    const label = node && strictAuditEditable(node.label, true);
    return Boolean(node && typeof node.id === 'string' &&
      safeId(node.id, 80) === node.id && label?.humanReviewed === true &&
      strictAuditCloneable(value, NODE_KEYS));
  }

  function strictAuditEdge(value, allowUnresolved = false, requireReviewed = false) {
    const edge = strictOwnDataRecord(value, EDGE_KEYS);
    const label = edge && strictAuditEditable(edge.label);
    const panelEvidenceRows = edge && strictGeneratedArray(
      edge.panelEvidence, MAX_PANEL_IDS_PER_BLOCK
    );
    if (!edge || typeof edge.id !== 'string' || safeId(edge.id, 80) !== edge.id ||
        typeof edge.from !== 'string' || safeId(edge.from, 80) !== edge.from ||
        typeof edge.to !== 'string' || safeId(edge.to, 80) !== edge.to || !label ||
        typeof edge.polarity !== 'string' || !MECHANISM_POLARITIES.has(edge.polarity) ||
        !panelEvidenceRows || typeof edge.humanReviewed !== 'boolean' ||
        (requireReviewed && edge.humanReviewed !== true) ||
        !strictAuditTimestamp(edge.editedAt)) return false;
    return panelEvidenceRows.every(rawEvidence =>
      Boolean(strictAuditPanelEvidence(rawEvidence, allowUnresolved))) &&
      strictAuditCloneableArray(edge.panelEvidence, panelEvidenceRows.length) &&
      strictAuditCloneable(value, EDGE_KEYS);
  }

  function strictGeneratedAuditEdge(value) {
    return strictAuditEdge(value, false, false);
  }

  function strictReviewedAuditEdge(value) {
    const edge = strictOwnDataRecord(value, EDGE_KEYS);
    const label = edge && strictAuditEditable(edge.label);
    const evidenceRows = edge && strictGeneratedArray(
      edge.panelEvidence, MAX_PANEL_IDS_PER_BLOCK
    );
    if (!edge || !label || !evidenceRows ||
        !strictAuditEdge(value, true, false)) return false;
    const reviewedEvidence = evidenceRows.some(rawEvidence => {
      const evidence = strictAuditPanelEvidence(rawEvidence, true);
      return evidence?.humanReviewed === true ||
        evidence?.evidenceClassSource === 'manual';
    });
    return edge.humanReviewed === true || label.humanReviewed === true || reviewedEvidence;
  }

  function strictGeneratedAuditChain(value, preview) {
    const chain = strictOwnDataRecord(value, ['nodes', 'edges']);
    if (!chain) return null;
    const rawNodes = strictGeneratedArray(chain.nodes, MAX_COLLECTION_ITEMS);
    const rawEdges = strictGeneratedArray(chain.edges, MAX_COLLECTION_ITEMS);
    if (!rawNodes || !rawEdges) return null;
    const normalized = normalizeMechanismChain(value, createSafeMap());
    if (normalized.nodes.length !== rawNodes.length ||
        normalized.edges.length !== rawEdges.length) return null;
    const generatedNodeIds = new Set(preview.nodes.map(node => node.nodeId));
    for (const rawNode of rawNodes) {
      const identity = strictOwnDataRecord(rawNode, ['id']);
      if (!identity || typeof identity.id !== 'string' ||
          safeId(identity.id, 80) !== identity.id ||
          (generatedNodeIds.has(identity.id)
            ? !strictGeneratedAuditNode(rawNode)
            : !strictReviewedAuditNode(rawNode))) {
        return null;
      }
    }
    const generatedEdgeIds = new Set(preview.relations
      .filter(relation => relation.renderable === true)
      .map(relation => relation.relationId));
    for (const rawEdge of rawEdges) {
      const identity = strictOwnDataRecord(rawEdge, ['id']);
      if (!identity || typeof identity.id !== 'string' ||
          safeId(identity.id, 80) !== identity.id ||
          (generatedEdgeIds.has(identity.id)
            ? !strictGeneratedAuditEdge(rawEdge)
            : !strictReviewedAuditEdge(rawEdge))) {
        return null;
      }
    }
    if (!strictAuditCloneableArray(chain.nodes, rawNodes.length) ||
        !strictAuditCloneableArray(chain.edges, rawEdges.length)) return null;
    return normalized;
  }

  function strictExistingMechanismReviewForGeneration(value, preview) {
    const chain = strictOwnDataRecord(value, ['nodes', 'edges']);
    if (!chain) return false;
    const rawNodes = strictGeneratedArray(chain.nodes, MAX_COLLECTION_ITEMS);
    const rawEdges = strictGeneratedArray(chain.edges, MAX_COLLECTION_ITEMS);
    if (!rawNodes || !rawEdges) return false;
    const normalized = normalizeMechanismChain(value, createSafeMap());
    if (normalized.nodes.length !== rawNodes.length ||
        normalized.edges.length !== rawEdges.length) return false;
    const generatedNodeIds = new Set(preview.nodes.map(node => node.nodeId));
    const normalizedNodes = new Map(normalized.nodes.map(node => [node.id, node]));
    for (const rawNode of rawNodes) {
      if (!strictGeneratedAuditNode(rawNode)) return false;
      const identity = strictOwnDataRecord(rawNode, ['id']);
      const node = normalizedNodes.get(identity.id);
      if (!generatedNodeIds.has(identity.id) &&
          node?.label?.humanReviewed === true && !strictReviewedAuditNode(rawNode)) {
        return false;
      }
    }
    const generatedEdgeIds = new Set(preview.relations
      .filter(relation => relation.renderable === true)
      .map(relation => relation.relationId));
    const normalizedEdges = new Map(normalized.edges.map(edge => [edge.id, edge]));
    for (const rawEdge of rawEdges) {
      if (!strictAuditEdge(rawEdge, true, false)) return false;
      const identity = strictOwnDataRecord(rawEdge, ['id']);
      const edge = normalizedEdges.get(identity.id);
      const reviewed = edge?.humanReviewed === true ||
        edge?.label?.humanReviewed === true ||
        edge?.panelEvidence?.some(item =>
          item.humanReviewed === true || item.evidenceClassSource === 'manual');
      if (!generatedEdgeIds.has(identity.id) && reviewed &&
          !strictReviewedAuditEdge(rawEdge)) return false;
    }
    return strictAuditCloneableArray(chain.nodes, rawNodes.length) &&
      strictAuditCloneableArray(chain.edges, rawEdges.length);
  }

  function mechanismChainValidationIssues(
    rawChain, rawFigures = [], rawMechanismGeneration = null
  ) {
    const chain = ownRecord(rawChain, CHAIN_KEYS);
    const rawNodes = cappedArrayValues(chain.nodes, MAX_COLLECTION_ITEMS)
      .map(rawNode => ownRecord(rawNode, NODE_KEYS));
    const nodes = rawNodes.map(node => ({ id: safeId(node.id, 80) }))
      .filter(node => node.id);
    const nodeIds = new Set(nodes.map(node => node.id));
    const edges = cappedArrayValues(chain.edges, MAX_COLLECTION_ITEMS)
      .map(rawEdge => ownRecord(rawEdge, [
        'id', 'from', 'to', 'sourceId', 'targetId', 'label', 'polarity', 'panelEvidence'
      ]))
      .map(edge => ({
        id: safeId(edge.id, 80),
        from: safeId(edge.from || edge.sourceId, 80),
        to: safeId(edge.to || edge.targetId, 80),
        label: normalizedEditable(edge.label).value,
        polarity: normalizeMechanismPolarity(edge.polarity),
        panelEvidence: cappedArrayValues(edge.panelEvidence, MAX_PANEL_IDS_PER_BLOCK)
      }));
    const issues = [];
    const add = (code, message, edgeIndex = -1) => {
      if (issues.length < 16) issues.push({ code, message, edgeIndex });
    };
    const normalizedGeneration = normalizeMechanismGeneration(rawMechanismGeneration);
    const normalizedAuditChain = normalizedGeneration
      ? strictGeneratedAuditChain(rawChain, normalizedGeneration.preview) : null;
    const auditMatches = Boolean(normalizedGeneration && normalizedAuditChain &&
      normalizedChainMatchesGeneration(
        normalizedAuditChain, normalizedGeneration.preview
      ));
    if (normalizedGeneration && !auditMatches) {
      add(
        'MECHANISM_GENERATION_AUDIT_MISMATCH',
        '当前机制链与已生成证据审计不一致，需要重新检查。'
      );
    }
    const auditedRelationIds = auditMatches
      ? new Set(normalizedGeneration.preview.relations
        .filter(relation => relation.renderable === true)
        .map(relation => relation.relationId))
      : new Set();
    const seenNodeIds = new Set();
    nodes.forEach((node, index) => {
      if (seenNodeIds.has(node.id)) {
        add('MECHANISM_NETWORK_DUPLICATE_NODE', `第 ${index + 1} 个节点 ID 重复。`);
      }
      seenNodeIds.add(node.id);
    });
    const seenEdges = new Map();
    const evidenceOptions = mechanismPanelEvidenceOptions(rawFigures);
    edges.forEach((edge, index) => {
      const endpointsValid = Boolean(
        edge.from && edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to)
      );
      if (!endpointsValid) {
        add('MECHANISM_CHAIN_EDGE_TARGET_INVALID', `第 ${index + 1} 条联系指向无效节点。`, index);
      }
      if (endpointsValid && edge.from === edge.to && edge.polarity === 'neutral') {
        add(
          'MECHANISM_NETWORK_SELF_LOOP_POLARITY_REQUIRED',
          `第 ${index + 1} 条自反馈必须标记为正反馈或负反馈。`,
          index
        );
      }
      const signature = [edge.from, edge.to, edge.polarity, edge.label].join('\u0000');
      const priorEdgeId = seenEdges.get(signature);
      const duplicate = priorEdgeId !== undefined;
      const auditedParallel = duplicate && edge.id !== priorEdgeId &&
        auditedRelationIds.has(edge.id) && auditedRelationIds.has(priorEdgeId);
      if (endpointsValid && duplicate && !auditedParallel) {
        add('MECHANISM_NETWORK_DUPLICATE_EDGE', `第 ${index + 1} 条联系重复。`, index);
      }
      seenEdges.set(signature, edge.id);
      edge.panelEvidence.forEach((rawEvidence, evidenceIndex) => {
        const evidence = ownRecord(rawEvidence, [
          'figureId', 'panelId', 'value', 'unresolved'
        ]);
        const figureId = safeId(evidence.figureId);
        const panelId = safePanelId(evidence.panelId);
        let matches = [];
        if (evidence.unresolved === true) {
          const displayId = mechanismPanelReference(evidence.value);
          const canonical = mechanismCanonicalPanelReference(displayId);
          matches = canonical ? evidenceOptions.filter(option =>
            `${option.figureId}:${option.panelId}` === canonical) : displayId
            ? evidenceOptions.filter(option => option.displayId === displayId) : [];
          add(
            matches.length > 1
              ? 'MECHANISM_PANEL_EVIDENCE_AMBIGUOUS'
              : matches.length === 1
                ? 'MECHANISM_PANEL_EVIDENCE_UNRESOLVED'
                : 'MECHANISM_PANEL_EVIDENCE_ORPHAN',
            `第 ${index + 1} 条联系的第 ${evidenceIndex + 1} 个 Panel 证据需要重新选择。`,
            index
          );
          return;
        }
        if (figureId && panelId) {
          matches = evidenceOptions.filter(option =>
            option.figureId === figureId && option.panelId === panelId
          );
          if (matches.length !== 1) {
            add(
              matches.length > 1
                ? 'MECHANISM_PANEL_EVIDENCE_AMBIGUOUS'
                : 'MECHANISM_PANEL_EVIDENCE_ORPHAN',
              `第 ${index + 1} 条联系的第 ${evidenceIndex + 1} 个 Panel 证据无法定位。`,
              index
            );
          }
          return;
        }
        const displayId = mechanismPanelReference(evidence.value);
        const canonical = mechanismCanonicalPanelReference(displayId);
        matches = canonical ? evidenceOptions.filter(option =>
          `${option.figureId}:${option.panelId}` === canonical) : displayId
          ? evidenceOptions.filter(option => option.displayId === displayId) : [];
        add(
          matches.length > 1
            ? 'MECHANISM_PANEL_EVIDENCE_AMBIGUOUS'
            : matches.length === 1
              ? 'MECHANISM_PANEL_EVIDENCE_UNRESOLVED'
              : 'MECHANISM_PANEL_EVIDENCE_ORPHAN',
          `第 ${index + 1} 条联系的第 ${evidenceIndex + 1} 个 Panel 证据需要重新选择。`,
          index
        );
      });
    });
    if (nodes.length > 1) {
      const adjacency = new Map(nodes.map(node => [node.id, new Set()]));
      edges.forEach(edge => {
        if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) return;
        adjacency.get(edge.from).add(edge.to);
        adjacency.get(edge.to).add(edge.from);
      });
      const visited = new Set();
      let componentCount = 0;
      nodes.forEach(node => {
        if (visited.has(node.id)) return;
        componentCount += 1;
        const queue = [node.id];
        visited.add(node.id);
        while (queue.length) {
          const current = queue.shift();
          adjacency.get(current).forEach(next => {
            if (!visited.has(next)) { visited.add(next); queue.push(next); }
          });
        }
      });
      if (componentCount > 1) add(
        'MECHANISM_NETWORK_DISCONNECTED_SUBGRAPH',
        `当前机制网络包含 ${componentCount} 个未连接子图。`
      );
    }
    for (const rawIssue of cappedArrayValues(chain.generationIssues, 16)) {
      const generationIssue = ownRecord(rawIssue, GENERATION_ISSUE_KEYS);
      const edgeId = safeId(generationIssue.edgeId, 80);
      const displayId = mechanismPanelReference(generationIssue.displayId);
      const canonical = mechanismCanonicalPanelReference(displayId);
      const edge = edges.find(candidate => candidate.id === edgeId);
      if (!edge || !displayId) continue;
      const repaired = edge.panelEvidence.some(rawEvidence => {
        const evidence = ownRecord(rawEvidence, [
          'figureId', 'panelId', 'unresolved'
        ]);
        if (evidence.unresolved === true) return false;
        const figureId = safeId(evidence.figureId);
        const panelId = safePanelId(evidence.panelId);
        return evidenceOptions.some(option =>
          option.figureId === figureId && option.panelId === panelId &&
          (canonical
            ? `${option.figureId}:${option.panelId}` === canonical
            : option.displayId === displayId)
        );
      });
      if (!repaired) add(
        boundedText(generationIssue.code, 80) || 'MECHANISM_PANEL_EVIDENCE_UNRESOLVED',
        boundedText(generationIssue.message, 240) ||
          `Panel 证据 ${displayId} 需要人工选择。`,
        typeof generationIssue.edgeIndex === 'number' ? generationIssue.edgeIndex : -1
      );
    }
    return issues;
  }

  function mechanismChainFromCrossFigure(rawCrossLogic, rawFigures) {
    const crossLogic = ownRecord(rawCrossLogic, ['mechanismEdges', 'mechanism_chain']);
    const rawEdges = Array.isArray(crossLogic.mechanismEdges)
      ? crossLogic.mechanismEdges : crossLogic.mechanism_chain;
    const panelCatalog = mechanismPanelEvidenceCatalog(rawFigures);
    const panelIndex = panelCatalog.byDisplay;
    const panelOptions = panelCatalog.entries;
    const nodes = [];
    const edges = [];
    const validationIssues = [];
    const nodeIdsByLabel = new Map();
    const edgeSignatures = new Set();
    let nodeCounter = 0;
    const nodeIdForLabel = label => {
      if (nodeIdsByLabel.has(label)) return nodeIdsByLabel.get(label);
      const node = { id: `mechanism-node-${++nodeCounter}`, label };
      nodes.push(node);
      nodeIdsByLabel.set(label, node.id);
      return node.id;
    };
    const issue = (code, message, edgeIndex, displayId = '') => {
      if (validationIssues.length >= 16) return;
      validationIssues.push({
        code,
        message: boundedText(message, 240),
        edgeIndex,
        edgeId: `mechanism-edge-${edgeIndex + 1}`,
        ...(displayId ? { displayId } : {})
      });
    };
    for (const rawEdge of cappedArrayValues(rawEdges, MAX_COLLECTION_ITEMS)) {
      if (!isPlainObject(rawEdge)) continue;
      const source = ownRecord(rawEdge, [
        'from', 'to', 'from_zh', 'to_zh', 'label', 'relation',
        'polarity', 'supportPanels', 'support_panel_refs'
      ]);
      const fromLabel = boundedText(source.from || source.from_zh, 240);
      const toLabel = boundedText(source.to || source.to_zh, 240);
      if (!fromLabel || !toLabel) continue;
      const edgeIndex = edges.length;
      const polarity = normalizeMechanismPolarity(source.polarity);
      const edgeLabel = boundedText(source.label || source.relation, 400);
      const signature = `${fromLabel}\u0000${toLabel}\u0000${polarity}\u0000${edgeLabel}`;
      if (edgeSignatures.has(signature)) continue;
      edgeSignatures.add(signature);
      const sourceId = nodeIdForLabel(fromLabel);
      const targetId = nodeIdForLabel(toLabel);
      const supportPanels = Array.isArray(source.supportPanels)
        ? source.supportPanels : source.support_panel_refs;
      const panelEvidence = [];
      const seenEvidence = new Set();
      for (const rawReference of cappedArrayValues(
        supportPanels, MAX_PANEL_IDS_PER_BLOCK
      )) {
        const reference = mechanismPanelReference(rawReference);
        const canonical = mechanismCanonicalPanelReference(reference);
        const matches = canonical ? panelOptions.filter(option =>
          `${option.figureId}:${option.panelId}` === canonical) :
          reference ? panelIndex.get(reference) || [] : [];
        if (matches.length !== 1) {
          const unresolvedReference = typeof rawReference === 'string'
            ? boundedText(rawReference, 200) : '';
          if (reference || unresolvedReference) issue(
            matches.length > 1
              ? 'MECHANISM_PANEL_EVIDENCE_AMBIGUOUS'
              : 'MECHANISM_PANEL_EVIDENCE_UNRESOLVED',
            `Panel 证据 ${reference || unresolvedReference} 无法唯一定位，请人工选择。`,
            edgeIndex,
            reference || unresolvedReference
          );
          continue;
        }
        const match = matches[0];
        const identity = `${match.figureId}\u0000${match.panelId}`;
        if (seenEvidence.has(identity)) continue;
        seenEvidence.add(identity);
        panelEvidence.push({ ...match });
      }
      edges.push({
        id: `mechanism-edge-${edgeIndex + 1}`,
        sourceId,
        targetId,
        from: sourceId,
        to: targetId,
        label: edgeLabel,
        polarity,
        panelEvidence
      });
    }
    return { nodes, edges, validationIssues };
  }

  function figureWorkspaceAnchorToken(value) {
    const codePoints = Array.from(String(value ?? ''));
    if (codePoints.length > MAX_ID_LENGTH) {
      throw workspaceError('FIGURE_WORKSPACE_ID_INVALID');
    }
    return `u${codePoints.map(character =>
      character.codePointAt(0).toString(16).padStart(6, '0')
    ).join('')}`;
  }

  function figureWorkspaceAnchorId(kind, figureId, panelId = '') {
    if (kind === 'figure') {
      return `figure-anchor-${figureWorkspaceAnchorToken(figureId)}`;
    }
    if (kind === 'panel') {
      return `panel-anchor-${figureWorkspaceAnchorToken(figureId)}-` +
        figureWorkspaceAnchorToken(panelId);
    }
    throw workspaceError('FIGURE_WORKSPACE_ID_INVALID');
  }

  function createFigureWorkspacePanelDescriptor({
    figureId, figureLabel, isSupplemental, panelId
  } = {}) {
    const stableFigureId = strictDescriptorFigureId(figureId);
    const stablePanelId = strictDescriptorPanelId(panelId);
    if (!stableFigureId || !stablePanelId) {
      throw workspaceError('FIGURE_WORKSPACE_ID_INVALID');
    }
    return {
      figureId: stableFigureId,
      panelId: stablePanelId,
      displayId: figurePanelDisplayId(figureLabel, isSupplemental, stablePanelId),
      figureAnchorId: figureWorkspaceAnchorId('figure', stableFigureId),
      panelAnchorId: figureWorkspaceAnchorId('panel', stableFigureId, stablePanelId)
    };
  }

  function editableValue(value = '', humanReviewed = false, editedAt = 0) {
    return {
      value: String(value || ''),
      humanReviewed: humanReviewed === true,
      editedAt: Math.max(0, Number(editedAt) || 0)
    };
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    try { if (Array.isArray(value)) return false; } catch (_) { return false; }
    let prototype;
    try { prototype = Object.getPrototypeOf(value); } catch (_) { return false; }
    // Inputs may already have a polluted prototype. We only read explicit
    // schema fields and construct fresh objects, so accepting that record lets
    // normalization salvage its own safe data without retaining the prototype.
    return prototype === Object.prototype || prototype === null || Boolean(prototype);
  }

  function ownRecord(value, keys, depth = 0) {
    if (depth > MAX_NESTED_DEPTH) return {};
    if (!isPlainObject(value)) return {};
    const record = Object.create(null);
    for (const key of Array.isArray(keys) ? keys : []) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_) { continue; }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
      record[key] = descriptor.value;
    }
    return record;
  }

  function strictOwnDataRecord(value, requiredKeys, optionalKeys = []) {
    if (!isPlainObject(value)) return null;
    const record = Object.create(null);
    for (const key of requiredKeys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { return null; }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      record[key] = descriptor.value;
    }
    for (const key of optionalKeys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { return null; }
      if (!descriptor) continue;
      if (!Object.hasOwn(descriptor, 'value')) return null;
      record[key] = descriptor.value;
    }
    return record;
  }

  function cappedArrayValues(value, maximum) {
    if (!Array.isArray(value)) return [];
    let length = 0;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return [];
      length = Math.min(maximum, Number(descriptor.value) || 0);
    } catch (_) { return []; }
    const values = [];
    for (let index = 0; index < length; index += 1) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); } catch (_) { continue; }
      if (descriptor && Object.hasOwn(descriptor, 'value')) values.push(descriptor.value);
    }
    return values;
  }

  function cappedMapEntries(value, maximum) {
    if (!isPlainObject(value)) return [];
    const entries = [];
    let visited = 0;
    try {
      for (const key in value) {
        if (visited >= maximum) break;
        visited += 1;
        if (BLOCKED_PROPERTY_NAMES.has(String(key).toLowerCase())) continue;
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_) { continue; }
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) continue;
        entries.push([key, descriptor.value]);
      }
    } catch (_) {}
    return entries;
  }

  function createSafeMap() {
    return Object.create(null);
  }

  function isLikelyOpaqueUri(scheme, payload) {
    const normalizedScheme = String(scheme || '').toLocaleLowerCase('en-US');
    if (KNOWN_OPAQUE_URI_SCHEMES.has(normalizedScheme)) return true;
    // Ambiguous opaque tokens are human scientific data unless they contain
    // credential syntax. Unambiguous scheme:// forms are removed separately.
    return /@/u.test(payload);
  }

  function stripDataUriTokens(text) {
    // A data URI can contain arbitrary nested markup. The caller has already
    // bounded the field, so discard the untrusted remainder rather than parse
    // or balance attacker-controlled tags.
    const match = /\bdata:(?=\S)/iu.exec(text);
    return match ? text.slice(0, match.index).trimEnd() : text;
  }

  function stripProtocolRelativeTokens(text) {
    // A bracketed IPv6 literal is part of the URL; outer prose brackets stay
    // because the payload portion stops before a second closing bracket.
    return text.replace(/\/\/(?:\[[0-9A-Fa-f:.]+\](?:\/[^\s<>"'`()\[\]{}，。；：、！？]+)?|[^\s<>"'`()\[\]{}，。；：、！？]+)/gu, '');
  }

  function stripUriTokens(text) {
    if (!/[:/@]|www\./iu.test(text)) return text;
    const withoutData = stripDataUriTokens(text);
    const withoutSchemes = withoutData
      .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"'`()\[\]{}，。；：、！？]+/gu, '')
      .replace(/\b([A-Za-z][A-Za-z0-9+.-]*):([^\s<>"'`()\[\]{}，。；：、！？]+)/gu,
        (token, scheme, payload) => !isLikelyOpaqueUri(scheme, payload) ? token : '');
    return stripProtocolRelativeTokens(withoutSchemes)
      .replace(/\bwww\.[^\s<>"'`]+/giu, '')
      .replace(/\s+/gu, ' ').trim();
  }

  function isTokenLikeCredential(value) {
    const token = String(value || '').replace(/[.,;!?)}\]]+$/gu, '');
    return /[^A-Za-z]/u.test(token);
  }

  function credentialWord(value) {
    return String(value || '').replace(/[.,;!?)}\]]+$/gu, '').toLowerCase();
  }

  function redactBareCredential(match, name, bearer, token) {
    if (String(bearer || '').trim()) return '';
    if (String(name || '').toLowerCase() === 'password') {
      return PASSWORD_PROSE_FOLLOWERS.has(credentialWord(token)) ? match : '';
    }
    return '';
  }

  function redactSpacedCredential(match, name, token) {
    const follower = credentialWord(token);
    return !isTokenLikeCredential(token) && SPACED_CREDENTIAL_PROSE_FOLLOWERS.has(follower)
      ? match : '';
  }

  function redactBearerCredential(match, name, token) {
    const prefix = String(name || '');
    if (prefix !== prefix.toLowerCase()) return '';
    return !isTokenLikeCredential(token) ? match : '';
  }

  function stripCredentialAssignments(text) {
    // boundedText caps input before this linear matcher runs. Keep the leading
    // non-word delimiter (for example a JSON `{`) while consuming an optional
    // quoted label, its connector, and the complete quoted/unquoted value.
    return text.replace(
      /(^|[^\p{L}\p{N}_])(?:(["'`]?)((?:api(?:[ _-]?key)|(?:access|refresh|auth|id)(?:[ _-]?token)|token|password|client(?:[ _-]?secret)))\2|“(?:api(?:[ _-]?key)|(?:access|refresh|auth|id)(?:[ _-]?token)|token|password|client(?:[ _-]?secret))”|‘(?:api(?:[ _-]?key)|(?:access|refresh|auth|id)(?:[ _-]?token)|token|password|client(?:[ _-]?secret))’)\s*(?::|=|\bis\b)\s*(?:Bearer\s+)?(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|“(?:\\.|[^”\\\r\n])*”|‘(?:\\.|[^’\\\r\n])*’|`(?:\\.|[^`\\\r\n])*`|"(?:\\.|[^"\\\r\n])*\\?$|'(?:\\.|[^'\\\r\n])*\\?$|“(?:\\.|[^”\\\r\n])*\\?$|‘(?:\\.|[^’\\\r\n])*\\?$|`(?:\\.|[^`\\\r\n])*\\?$|[^\s"'`‘’“”,;}\]]+)/giu,
      (match, leading) => {
        const field = match.slice(leading.length);
        return /^authorization\s*(?::|=)\s*basic\s+science\b/u.test(field)
          ? match : leading;
      }
    );
  }

  function stripExplicitAuthorizationCredentials(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.normalize('NFKC');
    // A credential can share a bounded note field with a later scientific
    // sentence. A period followed by whitespace and an uppercase/CJK sentence
    // start is the only recovery boundary we trust; everything before it is
    // removed atomically, including malformed extra auth tokens.
    const withoutCredentialSentence = normalized.replace(
      /(^|[^\p{L}\p{N}_"'`“‘])(?:["'`“‘]?Authorization["'`”’]?)\s*(?::|=)\s*[\s\S]*?(?:["'`”’])?\.\s+(?=[\p{Lu}\p{Lt}\d\u3400-\u9fff])/gmu,
      (match, leading) => leading
    );
    // AWS Signature V4 uses semicolon-delimited SignedHeaders/Signature
    // continuations. Treat the complete Authorization field atomically so no
    // credential tail survives the generic semicolon boundary below.
    const withoutAws4Authorization = withoutCredentialSentence.replace(
      /(^|[^\p{L}\p{N}_"'`“‘])(?:["'`“‘]?Authorization["'`”’]?)\s*(?::|=)\s*(?:["'`“‘]?)AWS4-HMAC-SHA256\b[^\r\n]*/gimu,
      (match, leading) => leading
    );
    return withoutAws4Authorization.replace(
      /(^|[^\p{L}\p{N}_"'`“‘])(?:["'`“‘]?)(Authorization)(?:["'`”’]?)\s*(?::|=)\s*((?:["'`“‘][^;\r\n]*(?=;|$))|(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\s+(?:(?:"(?:\\.|[^"\\\r\n])*")|(?:'(?:\\.|[^'\\\r\n])*')|(?:`(?:\\.|[^`\\\r\n])*`)|(?:“[^”\r\n]*”)|(?:‘[^’\r\n]*’)|[^\s,;\r\n]+)(?:\s*,\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\s*=\s*(?:(?:"(?:\\.|[^"\\\r\n])*")|(?:'(?:\\.|[^'\\\r\n])*')|(?:`(?:\\.|[^`\\\r\n])*`)|(?:“[^”\r\n]*”)|(?:‘[^’\r\n]*’)|[^\s,;\r\n]+))?)*)?))/gimu,
      (match, leading, label, authorizationValue) => {
        // A lowercase prose label is common in methods writing. This exact
        // scientific construction is not an HTTP header and carries no secret.
        if (label === label.toLowerCase() &&
            /^basic\s+science\b/iu.test(authorizationValue)) return match;
        return leading;
      }
    ).replace(/\s*;\s*/gu, '; ')
      .replace(/^(?:;\s*)+|(?:;\s*)+$/gu, '').trim();
  }

  function stripCredentialTokens(text) {
    if (!/(?:authorization|bearer|api[ _-]?key|apikey|(?:access|refresh|auth|id)[ _-]?token|token|password|client[ _-]?secret|sk-)/iu.test(text)) {
      return text;
    }
    return stripCredentialAssignments(stripExplicitAuthorizationCredentials(text))
      .replace(/\b(Bearer)\s+(\S+)/giu, redactBearerCredential)
      .replace(/\b(api key|(?:access|refresh|auth|id) token|client secret)\s+(\S+)/giu,
        redactSpacedCredential)
      .replace(/\b(api[_-]?key|apikey|(?:access|refresh|auth|id)[_-]?token|password|client[_-]?secret)\s+(Bearer\s+)?(\S+)/giu,
        redactBareCredential)
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '')
      .replace(/\s+/gu, ' ').trim();
  }

  function boundedText(value, maximum = MAX_TEXT_LENGTH) {
    const valueType = typeof value;
    if (!['string', 'number', 'boolean', 'bigint'].includes(valueType)) return '';
    const requestedLimit = Math.max(0, maximum);
    const limit = activeNormalizationTextBudget
      ? Math.min(requestedLimit, activeNormalizationTextBudget.remaining)
      : requestedLimit;
    if (!limit) return '';
    let raw = '';
    try { raw = String(value).slice(0, limit); } catch (_) { return ''; }
    const text = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ').trim().slice(0, limit);
    const bounded = stripUriTokens(stripCredentialTokens(text));
    if (activeNormalizationTextBudget) {
      activeNormalizationTextBudget.remaining = Math.max(
        0, activeNormalizationTextBudget.remaining - bounded.length
      );
    }
    return bounded;
  }

  function isCanonicalMechanismWorkspaceText(value, maximum = MAX_TEXT_LENGTH) {
    if (typeof value !== 'string' || !Number.isSafeInteger(maximum) ||
        maximum < 0 || maximum > MAX_TEXT_LENGTH || value.length > maximum * 2 ||
        Array.from(value).length > maximum) return false;
    const previousBudget = activeNormalizationTextBudget;
    activeNormalizationTextBudget = null;
    try { return boundedText(value, maximum) === value; }
    catch (_) { return false; }
    finally { activeNormalizationTextBudget = previousBudget; }
  }

  function isCanonicalMechanismWorkspacePanelReference(value) {
    try {
      return typeof value === 'string' &&
        mechanismPanelReference(value) === value;
    } catch (_) {
      return false;
    }
  }

  function boundedTimestamp(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(MAX_TIMESTAMP, Math.max(0, Math.floor(number)));
  }

  function boundedRevision(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(MAX_REVISION, Math.max(0, Math.floor(number)));
  }

  function safeId(value, maximum = MAX_ID_LENGTH) {
    const id = boundedText(value, maximum);
    return id && !BLOCKED_PROPERTY_NAMES.has(id.toLowerCase()) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)
      ? id : '';
  }

  function safePanelId(value) {
    const id = boundedText(value, 32).toUpperCase();
    return !BLOCKED_PROPERTY_NAMES.has(id.toLowerCase()) && /^[A-Z0-9][A-Z0-9_.+-]*$/u.test(id)
      ? id : '';
  }

  function strictDescriptorId(value, maximum, pattern, uppercase = false) {
    if (value !== null && typeof value === 'object') return '';
    let id;
    try {
      const raw = String(value ?? '');
      if (raw.length > maximum * 2) return '';
      id = raw.normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f]/gu, ' ')
        .replace(/\s+/gu, ' ').trim();
    } catch (_) {
      return '';
    }
    if (Array.from(id).length > maximum) return '';
    if (uppercase) id = id.toUpperCase();
    if (Array.from(id).length > maximum) return '';
    return id && !BLOCKED_PROPERTY_NAMES.has(id.toLowerCase()) && pattern.test(id)
      ? id : '';
  }

  function strictDescriptorFigureId(value) {
    return strictDescriptorId(value, MAX_ID_LENGTH, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
  }

  function strictDescriptorPanelId(value) {
    return strictDescriptorId(value, 32, /^[A-Z0-9][A-Z0-9_.+-]*$/u, true);
  }

  function normalizedEditable(value, legacyIsHumanReviewed = true, protectLegacyMetadata = false) {
    if (value === undefined) return editableValue();
    if (isPlainObject(value)) {
      const source = ownRecord(value, EDITABLE_KEYS);
      const hasReviewMetadata = typeof source.humanReviewed === 'boolean' &&
        strictAuditTimestamp(source.editedAt);
      return editableValue(
        boundedText(source.value), source.humanReviewed === true ||
          (!hasReviewMetadata && legacyIsHumanReviewed && protectLegacyMetadata), boundedTimestamp(source.editedAt)
      );
    }
    return editableValue(boundedText(value), legacyIsHumanReviewed, 0);
  }

  function normalizedEditableList(value, maximum = MAX_COLLECTION_ITEMS, legacyIsHumanReviewed = true, protectLegacyMetadata = false) {
    if (value === undefined || value === null) return [];
    const source = Array.isArray(value) ? cappedArrayValues(value, maximum) : [value];
    return source.map(item => normalizedEditable(item, legacyIsHumanReviewed, protectLegacyMetadata));
  }

  function normalizeScientificQuestionList(
    value,
    legacyIsHumanReviewed = true,
    includePlaceholder = true,
    trustReviewMetadata = true
  ) {
    const source = Array.isArray(value)
      ? cappedArrayValues(value, MAX_COLLECTION_ITEMS)
      : (value === undefined || value === null ? [] : [value]);
    const usedIds = new Set();
    const candidates = source.map((item, index) => {
      const record = isPlainObject(item) ? ownRecord(item, SCIENTIFIC_QUESTION_KEYS) : {};
      const requestedId = safeId(record.questionId, 100);
      let questionId = requestedId && !usedIds.has(requestedId)
        ? requestedId : `question-${index + 1}`;
      let suffix = 2;
      while (usedIds.has(questionId)) {
        questionId = `question-${index + 1}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(questionId);
      const rawText = Object.hasOwn(record, 'text') ? record.text
        : Object.hasOwn(record, 'value') ? record.value : item;
      const questionText = boundedText(rawText);
      const relationToken = typeof record.relationType === 'string'
        ? record.relationType.normalize('NFKC').trim().toLowerCase() : '';
      return {
        questionId,
        text: questionText,
        value: questionText,
        relationType: SCIENTIFIC_QUESTION_RELATIONS.has(relationToken)
          ? relationToken : 'root',
        rawParentQuestionIds: record.parentQuestionIds,
        rawSupportingFigureIds: record.supportingFigureIds,
        humanReviewed: isPlainObject(item) && trustReviewMetadata
          ? record.humanReviewed === true : legacyIsHumanReviewed,
        editedAt: isPlainObject(item) && trustReviewMetadata
          ? boundedTimestamp(record.editedAt) : 0
      };
    });
    const questionIds = new Set(candidates.map(item => item.questionId));
    const normalized = candidates.map(item => {
      let parentQuestionIds = [...new Set(
        cappedArrayValues(item.rawParentQuestionIds, 12)
          .map(parentId => safeId(parentId, 100))
          .filter(parentId => parentId && parentId !== item.questionId &&
            questionIds.has(parentId))
      )];
      let relationType = item.relationType;
      if (relationType === 'root') parentQuestionIds = [];
      else if (!parentQuestionIds.length) relationType = 'root';
      else if (relationType === 'convergent' && parentQuestionIds.length < 2) {
        relationType = 'progressive';
      }
      const supportingFigureIds = [...new Set(
        cappedArrayValues(item.rawSupportingFigureIds, MAX_FIGURES)
          .map(figureId => safeId(figureId))
          .filter(Boolean)
      )];
      return {
        questionId: item.questionId,
        text: item.text,
        value: item.value,
        relationType,
        parentQuestionIds,
        supportingFigureIds,
        humanReviewed: item.humanReviewed,
        editedAt: item.editedAt
      };
    });
    return normalized.length || !includePlaceholder
      ? normalized
      : [{
          questionId: 'question-1', text: '', value: '', relationType: 'root',
          parentQuestionIds: [], supportingFigureIds: [],
          humanReviewed: false, editedAt: 0
        }];
  }

  function normalizedModelEditable(value) {
    const candidate = isPlainObject(value)
      ? ownRecord(value, EDITABLE_KEYS).value : value;
    return editableValue(boundedText(candidate), false, 0);
  }

  function normalizedModelEditableList(value, maximum = MAX_COLLECTION_ITEMS) {
    if (value === undefined || value === null) return [];
    const source = Array.isArray(value)
      ? cappedArrayValues(value, maximum) : [value];
    return source.map(normalizedModelEditable);
  }

  function normalizeModelOverview(value) {
    const source = ownRecord(value, OVERVIEW_KEYS);
    return Object.fromEntries(OVERVIEW_KEYS.filter(field => source[field] !== undefined)
      .map(field => [field, normalizedModelEditable(source[field])]));
  }

  function normalizeModelPanels(value, figureLabel, isSupplemental) {
    const panels = createSafeMap();
    for (const [rawId, rawPanel] of panelEntries(value)) {
      const source = ownRecord(rawPanel, PANEL_KEYS);
      const panelId = safePanelId(isPlainObject(rawPanel)
        ? source.panelId || source.panel || rawId : rawId);
      if (!panelId || Object.hasOwn(panels, panelId) ||
          Object.keys(panels).length >= MAX_PANELS_PER_FIGURE) continue;
      const panel = { panelId };
      if (source.observationSource !== undefined) {
        panel.observationSource = normalizePanelObservationSource(source.observationSource);
      }
      for (const field of PANEL_SCALAR_FIELDS) {
        if (field !== 'note' && source[field] !== undefined) {
          panel[field] = normalizedModelEditable(source[field]);
        }
      }
      const methods = source.experimentalMethods === undefined ? source.methods : source.experimentalMethods;
      if (methods !== undefined) panel.experimentalMethods = normalizedModelEditableList(methods, 16);
      if (source.statisticalMethods !== undefined) {
        panel.statisticalMethods = normalizedModelEditableList(source.statisticalMethods, 16);
      }
      panels[panelId] = panel;
    }
    return panels;
  }

  function emptyOverview() {
    return {
      figureQuestion: editableValue(),
      coreConclusion: editableValue(),
      claimBoundary: editableValue(),
      authorAssembly: editableValue(),
      remainingQuestion: editableValue()
    };
  }

  // Names are optional human display overrides, separate from scientific fields.
  // Old drafts stay byte-stable and model input cannot introduce these records.
  function optionalDisplayName(source, allow = true) {
    return allow && source.displayName !== undefined
      ? { displayName: normalizedEditable(source.displayName, true, true) } : {};
  }

  function mergeDisplayNames(existing, incoming) {
    if (!existing.displayName && !incoming.displayName) return {};
    return { displayName: mergeEditableValues(
      existing.displayName || editableValue(), incoming.displayName || editableValue()) };
  }

  function normalizeOverview(value, legacyIsHumanReviewed = true) {
    const source = ownRecord(value, [...OVERVIEW_KEYS, 'displayName']);
    return {
      ...optionalDisplayName(source, legacyIsHumanReviewed !== false),
      figureQuestion: normalizedEditable(source.figureQuestion, legacyIsHumanReviewed, true),
      coreConclusion: normalizedEditable(source.coreConclusion, legacyIsHumanReviewed, true),
      claimBoundary: normalizedEditable(source.claimBoundary, legacyIsHumanReviewed, true),
      authorAssembly: normalizedEditable(source.authorAssembly, legacyIsHumanReviewed, true),
      remainingQuestion: normalizedEditable(source.remainingQuestion, legacyIsHumanReviewed, true)
    };
  }

  function emptyPanel(panelId, figureLabel, isSupplemental) {
    return {
      panelId,
      compactId: figurePanelDisplayId(figureLabel, isSupplemental, panelId),
      purpose: editableValue(),
      evidenceType: editableValue(),
      directObservation: editableValue(),
      experimentalMethods: [],
      statisticalMethods: [],
      comparison: editableValue(),
      note: editableValue(),
      phenotypeName: editableValue(),
      design: editableValue(),
      localInference: editableValue(),
      contribution: editableValue()
    };
  }

  function normalizePanel(
    value, panelId, figureLabel, legacyIsHumanReviewed = true, isSupplemental
  ) {
    const source = ownRecord(value, PANEL_KEYS);
    return {
      panelId,
      ...optionalDisplayName(source, legacyIsHumanReviewed !== false),
      ...(legacyIsHumanReviewed !== false && source.provenance === 'manual' ? { provenance: 'manual' } : {}),
      compactId: figurePanelDisplayId(figureLabel, isSupplemental, panelId),
      purpose: normalizedEditable(source.purpose, legacyIsHumanReviewed, true),
      evidenceType: normalizedEditable(source.evidenceType, legacyIsHumanReviewed, true),
      directObservation: normalizedEditable(source.directObservation, legacyIsHumanReviewed, true),
      ...(source.observationSource !== undefined ? {
        observationSource: normalizePanelObservationSource(source.observationSource)
      } : {}),
      experimentalMethods: normalizedEditableList(
        source.experimentalMethods === undefined ? source.methods : source.experimentalMethods,
        16, legacyIsHumanReviewed, true
      ),
      statisticalMethods: normalizedEditableList(source.statisticalMethods, 16, legacyIsHumanReviewed, true),
      comparison: normalizedEditable(source.comparison, legacyIsHumanReviewed, true),
      note: normalizedEditable(source.note, legacyIsHumanReviewed, true),
      phenotypeName: normalizedEditable(source.phenotypeName, legacyIsHumanReviewed, true),
      design: normalizedEditable(source.design, legacyIsHumanReviewed, true),
      localInference: normalizedEditable(source.localInference, legacyIsHumanReviewed, true),
      contribution: normalizedEditable(source.contribution, legacyIsHumanReviewed, true)
    };
  }

  function panelEntries(value) {
    if (Array.isArray(value)) {
      return cappedArrayValues(value, MAX_PANELS_PER_FIGURE).map(item => {
        if (isPlainObject(item)) {
          const record = ownRecord(item, PANEL_KEYS);
          return [record.panelId || record.panel || record.id, item];
        }
        return [item, {}];
      });
    }
    return cappedMapEntries(value, MAX_PANELS_PER_FIGURE);
  }

  function normalizePanels(
    value, figureLabel, legacyIsHumanReviewed = true, isSupplemental
  ) {
    const panels = createSafeMap();
    for (const [rawId, rawPanel] of panelEntries(value)) {
      const panel = ownRecord(rawPanel, PANEL_KEYS);
      const panelId = safePanelId(isPlainObject(rawPanel)
        ? panel.panelId || panel.panel || rawId : rawId);
      if (!panelId) continue;
      const normalized = normalizePanel(
        rawPanel, panelId, figureLabel, legacyIsHumanReviewed, isSupplemental
      );
      if (Object.hasOwn(panels, panelId)) {
        panels[panelId] = mergePanelRecords(
          panels[panelId], normalized, figureLabel, isSupplemental
        );
      } else if (Object.keys(panels).length < MAX_PANELS_PER_FIGURE) {
        panels[panelId] = normalized;
      }
    }
    return panels;
  }

  function normalizePanelsForView(
    value, figureLabel, legacyIsHumanReviewed = true, isSupplemental
  ) {
    const panels = createSafeMap();
    for (const [rawId, rawPanel] of panelEntries(value)) {
      const panel = ownRecord(rawPanel, PANEL_KEYS);
      const panelId = strictDescriptorPanelId(isPlainObject(rawPanel)
        ? panel.panelId || panel.panel || rawId : rawId);
      if (!panelId) continue;
      const normalized = normalizePanel(
        rawPanel, panelId, figureLabel, legacyIsHumanReviewed, isSupplemental
      );
      if (Object.hasOwn(panels, panelId)) {
        panels[panelId] = mergePanelRecords(
          panels[panelId], normalized, figureLabel, isSupplemental
        );
      } else if (Object.keys(panels).length < MAX_PANELS_PER_FIGURE) {
        panels[panelId] = normalized;
      }
    }
    return panels;
  }

  function normalizeFigureForView(value, fallbackId = '') {
    const source = ownRecord(value, FIGURE_KEYS);
    const figureId = strictDescriptorFigureId(source.figureId || source.id || fallbackId);
    if (!figureId) throw workspaceError('FIGURE_WORKSPACE_ID_INVALID');
    const figureLabel = boundedText(source.figureLabel || source.label, 240);
    const isSupplemental = inferSupplemental(
      figureId, figureLabel, source.isSupplemental
    );
    const panels = normalizePanelsForView(source.panels, figureLabel, true, isSupplemental);
    for (const [rawId, rawPanel] of panelEntries(source.panelHints)) {
      const panel = ownRecord(rawPanel, PANEL_KEYS);
      const panelId = strictDescriptorPanelId(isPlainObject(rawPanel)
        ? panel.panelId || panel.panel || rawId : rawId);
      if (!panelId || Object.hasOwn(panels, panelId) ||
          Object.keys(panels).length >= MAX_PANELS_PER_FIGURE) continue;
      panels[panelId] = emptyPanel(panelId, figureLabel, isSupplemental);
    }
    return {
      figureId,
      figureLabel,
      isSupplemental,
      overview: normalizeOverview(source.overview),
      panels,
      evidenceBlocks: normalizeEvidenceBlocks(source.evidenceBlocks),
      ...(source.evidenceBlockTombstones ? { evidenceBlockTombstones: normalizeEvidenceBlockTombstones(source.evidenceBlockTombstones) } : {}),
      ...(source.manualEvidenceArchive ? { manualEvidenceArchive: normalizeManualEvidenceArchive(source.manualEvidenceArchive, figureLabel, isSupplemental) } : {})
    };
  }

  function inferSupplemental(figureId, figureLabel, value) {
    if (value === true || value === false) return value;
    return /(?:^|[-_])s\d+/iu.test(figureId) || /(?:Figure\s*)?S\d+/iu.test(figureLabel);
  }

  function normalizeFigure(value, fallbackId = '') {
    const source = ownRecord(value, FIGURE_KEYS);
    const figureId = safeId(source.figureId || source.id || fallbackId);
    if (!figureId) return null;
    const figureLabel = boundedText(source.figureLabel || source.label, 240);
    const isModelResult = typeof source.analysisDepth === 'string';
    const modelOverview = isModelResult ? normalizeOverview({
      figureQuestion: source.figureQuestion,
      coreConclusion: source.coreConclusion,
      claimBoundary: source.claimBoundary,
      authorAssembly: source.authorAssembly,
      remainingQuestion: source.remainingQuestion
    }, false) : emptyOverview();
    const overview = normalizeOverview(source.overview);
    const isSupplemental = inferSupplemental(
      figureId, figureLabel, source.isSupplemental
    );
    for (const key of OVERVIEW_KEYS) {
      overview[key] = mergeEditableValues(overview[key], modelOverview[key]);
    }
    return {
      figureId,
      figureLabel,
      isSupplemental,
      overview,
      panels: normalizePanels(source.panels, figureLabel, !isModelResult, isSupplemental),
      evidenceBlocks: normalizeEvidenceBlocks(source.evidenceBlocks, !isModelResult),
      ...(!isModelResult && source.evidenceBlockTombstones ? { evidenceBlockTombstones: normalizeEvidenceBlockTombstones(source.evidenceBlockTombstones) } : {}),
      ...(!isModelResult && source.manualEvidenceArchive ? { manualEvidenceArchive: normalizeManualEvidenceArchive(source.manualEvidenceArchive, figureLabel, isSupplemental) } : {})
    };
  }

  function normalizeEditableList(value) {
    const source = Array.isArray(value)
      ? cappedArrayValues(value, MAX_COLLECTION_ITEMS)
      : (value === undefined ? [] : [value]);
    const values = source.map(item => normalizedEditable(item));
    return values.length ? values : [editableValue()];
  }

  function mergeEditableValues(existing, incoming) {
    if (existing.humanReviewed && incoming.humanReviewed) {
      return incoming.editedAt > existing.editedAt ? incoming : existing;
    }
    if (existing.humanReviewed) return existing;
    if (incoming.humanReviewed) return incoming;
    if (existing.value) return existing;
    return incoming.value ? incoming : existing;
  }

  function mergeEditableLists(existing, incoming, maximum = MAX_COLLECTION_ITEMS) {
    const values = [];
    for (const item of [...existing, ...incoming]) {
      const duplicate = values.findIndex(value => value.value === item.value);
      if (duplicate >= 0) values[duplicate] = mergeEditableValues(values[duplicate], item);
      else if (values.length < maximum) values.push(item);
    }
    return values;
  }

  function mergePanelRecords(existing, incoming, figureLabel, isSupplemental) {
    const panelId = existing.panelId;
    if (existing.provenance === 'manual') return {
      ...existing, compactId: figurePanelDisplayId(figureLabel, isSupplemental, panelId)
    };
    const directObservation = mergeEditableValues(existing.directObservation, incoming.directObservation);
    const observationOwner = directObservation === existing.directObservation ? existing : incoming;
    return {
      panelId,
      ...mergeDisplayNames(existing, incoming),
      ...(incoming.provenance === 'manual' ? { provenance: 'manual' } : {}),
      compactId: figurePanelDisplayId(figureLabel, isSupplemental, panelId),
      purpose: mergeEditableValues(existing.purpose, incoming.purpose),
      evidenceType: mergeEditableValues(existing.evidenceType, incoming.evidenceType),
      directObservation,
      ...(observationOwner.observationSource !== undefined ? {
        observationSource: normalizePanelObservationSource(observationOwner.observationSource)
      } : {}),
      experimentalMethods: mergeEditableLists(existing.experimentalMethods, incoming.experimentalMethods, 16),
      statisticalMethods: mergeEditableLists(existing.statisticalMethods, incoming.statisticalMethods, 16),
      comparison: mergeEditableValues(existing.comparison, incoming.comparison),
      note: mergeEditableValues(existing.note, incoming.note),
      phenotypeName: mergeEditableValues(existing.phenotypeName, incoming.phenotypeName),
      design: mergeEditableValues(existing.design, incoming.design),
      localInference: mergeEditableValues(existing.localInference, incoming.localInference),
      contribution: mergeEditableValues(existing.contribution, incoming.contribution)
    };
  }

  function mergeFigureRecords(existing, incoming) {
    const figureLabel = existing.figureLabel || incoming.figureLabel;
    const isSupplemental = existing.isSupplemental;
    const tombstones = normalizeEvidenceBlockTombstones([...(existing.evidenceBlockTombstones || []), ...(incoming.evidenceBlockTombstones || [])]);
    const archive = mergeManualEvidenceArchives(existing.manualEvidenceArchive, incoming.manualEvidenceArchive, figureLabel, isSupplemental);
    const overview = { ...mergeDisplayNames(existing.overview, incoming.overview) };
    for (const key of Object.keys(emptyOverview())) {
      overview[key] = mergeEditableValues(existing.overview[key], incoming.overview[key]);
    }
    const panels = createSafeMap();
    for (const [panelId, panel] of cappedMapEntries(existing.panels, MAX_PANELS_PER_FIGURE)) {
      panels[panelId] = panel;
    }
    for (const [panelId, panel] of cappedMapEntries(incoming.panels, MAX_PANELS_PER_FIGURE)) {
      if (Object.hasOwn(panels, panelId)) {
        panels[panelId] = mergePanelRecords(
          panels[panelId], panel, figureLabel, isSupplemental
        );
      } else if (Object.keys(panels).length < MAX_PANELS_PER_FIGURE) {
        panels[panelId] = {
          ...panel,
          compactId: figurePanelDisplayId(figureLabel, isSupplemental, panelId)
        };
      }
    }
    return {
      figureId: existing.figureId,
      figureLabel,
      isSupplemental,
      overview,
      panels,
      ...(tombstones.length ? { evidenceBlockTombstones: tombstones } : {}),
      ...(archive.length ? { manualEvidenceArchive: archive } : {}),
      evidenceBlocks: mergeEvidenceBlockCollections(
        existing.evidenceBlocks, incoming.evidenceBlocks, false, tombstones
      )
    };
  }

  function normalizeResearchSourceRefs(value) {
    return cappedArrayValues(value, 12).map(raw => {
      const source = ownRecord(raw, [
        'paragraphId', 'sourceIdentity', 'sourceKey', 'textHash', 'quote',
        'sectionPath', 'documentHash', 'citationRefs'
      ]);
      const paragraphId = safeId(source.paragraphId, 240);
      const sourceIdentity = boundedText(source.sourceIdentity, 360);
      const sourceKey = boundedText(source.sourceKey, 360);
      const quote = boundedText(source.quote, 360);
      if (!paragraphId && !sourceIdentity && !sourceKey && !quote) return null;
      return {
        paragraphId, sourceIdentity, sourceKey,
        textHash: boundedText(source.textHash, 160),
        quote,
        sectionPath: cappedArrayValues(source.sectionPath, 12)
          .map(item => boundedText(item, 180)).filter(Boolean),
        documentHash: boundedText(source.documentHash, 160),
        citationRefs: cappedArrayValues(source.citationRefs, 16)
          .map(item => boundedText(item, 80)).filter(Boolean)
      };
    }).filter(Boolean);
  }

  function normalizeResearchEvidenceAtoms(value) {
    const allowedTypes = new Set([
      'background', 'known_mechanism', 'prior_evidence', 'knowledge_gap',
      'rationale', 'result', 'question', 'hypothesis', 'author_aim'
    ]);
    const result = [];
    const seen = new Set();
    for (const raw of cappedArrayValues(value, 160)) {
      const source = ownRecord(raw, [
        'evidenceId', 'type', 'statement', 'sourceRefs', 'evidenceRole',
        'directness', 'origin', 'confidence', 'verificationStatus'
      ]);
      const evidenceId = safeId(source.evidenceId, 80);
      const type = boundedText(source.type, 80).toLowerCase();
      const statement = boundedText(source.statement, 1200);
      if (!evidenceId || !allowedTypes.has(type) || !statement || seen.has(evidenceId)) continue;
      seen.add(evidenceId);
      result.push({
        evidenceId, type, statement,
        sourceRefs: normalizeResearchSourceRefs(source.sourceRefs),
        evidenceRole: boundedText(source.evidenceRole, 80),
        directness: boundedText(source.directness, 80),
        origin: boundedText(source.origin, 80),
        confidence: boundedText(source.confidence, 40),
        verificationStatus: boundedText(source.verificationStatus, 80)
      });
    }
    return result;
  }

  function normalizeResearchQuestionNode(value, fallbackId) {
    const source = ownRecord(value, [
      'questionId', 'text', 'authorWording', 'evidenceIds', 'origin', 'confidence',
      'generatedFrom', 'hypothesis', 'test', 'result', 'warrantedConclusion',
      'remainingGap', 'causalLevel'
    ]);
    const text = boundedText(source.text, 1200);
    if (!text) return null;
    return {
      questionId: safeId(source.questionId, 80) || fallbackId,
      text,
      authorWording: boundedText(source.authorWording, 1200),
      evidenceIds: cappedArrayValues(source.evidenceIds, 16)
        .map(item => safeId(item, 80)).filter(Boolean),
      origin: boundedText(source.origin, 80),
      confidence: boundedText(source.confidence, 40),
      generatedFrom: cappedArrayValues(source.generatedFrom, 8)
        .map(item => safeId(item, 80)).filter(Boolean),
      hypothesis: boundedText(source.hypothesis, 1200),
      test: boundedText(source.test, 1200),
      result: boundedText(source.result, 1200),
      warrantedConclusion: boundedText(source.warrantedConclusion, 1200),
      remainingGap: boundedText(source.remainingGap, 1200),
      causalLevel: boundedText(source.causalLevel, 80)
    };
  }

  function emptyResearchLogic() {
    return {
      version: '', partial: false, taskState: 'idle', atomicEvidence: [],
      questionTrace: { coreQuestion: null, bridge: [] }, progression: [],
      audit: { validCoreQuestion: false, acceptedProgressionIds: [], issues: [], audited: false },
      generatedAt: 0, profileSignature: ''
    };
  }

  function normalizeResearchLogic(value) {
    const source = ownRecord(value, [
      'version', 'partial', 'taskState', 'atomicEvidence', 'questionTrace',
      'progression', 'audit', 'generatedAt', 'profileSignature'
    ]);
    const traceSource = ownRecord(source.questionTrace, ['coreQuestion', 'bridge']);
    const coreQuestion = normalizeResearchQuestionNode(traceSource.coreQuestion, 'Q0');
    const bridge = cappedArrayValues(traceSource.bridge, 24).map((raw, index) => {
      const item = ownRecord(raw, [
        'traceId', 'type', 'evidenceIds', 'statement', 'relation', 'origin'
      ]);
      const type = boundedText(item.type, 4).toUpperCase();
      if (!/^[BKEXGRQHA]$/u.test(type)) return null;
      return {
        traceId: safeId(item.traceId, 80) || `trace-${index + 1}`,
        type,
        evidenceIds: cappedArrayValues(item.evidenceIds, 16)
          .map(id => safeId(id, 80)).filter(Boolean),
        statement: boundedText(item.statement, 1200),
        relation: boundedText(item.relation, 120),
        origin: boundedText(item.origin, 80)
      };
    }).filter(Boolean);
    const progression = cappedArrayValues(source.progression, 4)
      .map((item, index) => normalizeResearchQuestionNode(item, `Q${index + 1}`))
      .filter(Boolean);
    const auditSource = ownRecord(source.audit, [
      'validCoreQuestion', 'acceptedProgressionIds', 'issues', 'audited', 'evidenceCoverage'
    ]);
    return {
      version: boundedText(source.version, 40),
      partial: source.partial === true,
      taskState: boundedText(source.taskState, 80) || (coreQuestion ? 'complete' : 'idle'),
      atomicEvidence: normalizeResearchEvidenceAtoms(source.atomicEvidence),
      questionTrace: { coreQuestion, bridge },
      progression,
      audit: {
        validCoreQuestion: auditSource.validCoreQuestion === true,
        acceptedProgressionIds: cappedArrayValues(auditSource.acceptedProgressionIds, 8)
          .map(id => safeId(id, 80)).filter(Boolean),
        issues: cappedArrayValues(auditSource.issues, 32)
          .map(item => boundedText(item, 500)).filter(Boolean),
        audited: auditSource.audited === true,
        evidenceCoverage: Math.max(0, Number(auditSource.evidenceCoverage) || 0)
      },
      generatedAt: boundedTimestamp(source.generatedAt),
      profileSignature: boundedText(source.profileSignature, 400)
    };
  }

  function normalizePaperMetaPoint(value, fallbackId) {
    const source = ownRecord(value, [
      'pointId', 'text', 'value', 'evidenceIds', 'origin', 'confidence', 'scope'
    ]);
    const text = boundedText(source.text || source.value, 1200);
    if (!text) return null;
    return {
      pointId: safeId(source.pointId, 80) || fallbackId,
      text,
      evidenceIds: cappedArrayValues(source.evidenceIds, 16)
        .map(item => safeId(item, 80)).filter(Boolean),
      origin: boundedText(source.origin, 80),
      confidence: boundedText(source.confidence, 40),
      scope: boundedText(source.scope, 240)
    };
  }

  function normalizePaperMetaDetails(value) {
    const source = ownRecord(value, ['innovationPoints', 'limitationPoints']);
    const collect = (items, prefix) => cappedArrayValues(items, 12)
      .map((item, index) => normalizePaperMetaPoint(item, `${prefix}-${index + 1}`))
      .filter(Boolean);
    return {
      innovationPoints: collect(source.innovationPoints, 'innovation'),
      limitationPoints: collect(source.limitationPoints, 'limitation')
    };
  }

  function normalizeMeta(value) {
    const source = ownRecord(value, META_KEYS);
    return {
      backgroundItems: normalizeEditableList(source.backgroundItems || source.researchBackground),
      scientificQuestions: normalizeScientificQuestionList(
        source.scientificQuestions || source.scientificQuestion
      ),
      innovationPoints: normalizeEditableList(source.innovationPoints),
      limitationPoints: normalizeEditableList(source.limitationPoints),
      researchLogic: normalizeResearchLogic(source.researchLogic),
      paperMetaDetails: normalizePaperMetaDetails(source.paperMetaDetails)
    };
  }

  function normalizedEvidencePanelIds(value) {
    const panelIds = [];
    const seen = new Set();
    for (const rawPanelId of cappedArrayValues(value, MAX_PANEL_IDS_PER_BLOCK)) {
      const panelId = safePanelId(rawPanelId);
      if (panelId && !seen.has(panelId)) {
        seen.add(panelId);
        panelIds.push(panelId);
      }
    }
    return panelIds;
  }

  function normalizeEvidenceGroupLabel(value) {
    return boundedText(value, 240).toLocaleLowerCase('en-US')
      .replace(/[\p{P}\p{S}\s]+/gu, '');
  }

  function evidenceGroupAliases(block, index) {
    const aliases = new Set([
      normalizeEvidenceGroupLabel(block.groupGoal),
      normalizeEvidenceGroupLabel(block.groupConclusion),
      normalizeEvidenceGroupLabel(`group ${index + 1}`),
      normalizeEvidenceGroupLabel(`evidence group ${index + 1}`),
      normalizeEvidenceGroupLabel(`证据组 ${index + 1}`)
    ].filter(Boolean));
    return aliases;
  }

  function joinedEvidenceText(values) {
    const joined = [];
    const seen = new Set();
    for (const value of values) {
      const text = boundedText(value);
      if (text && !seen.has(text)) {
        seen.add(text);
        joined.push(text);
      }
    }
    return boundedText(joined.join('\n'));
  }

  function normalizedArgumentStep(value, index) {
    const source = ownRecord(value, RESULT_ARGUMENT_STEP_KEYS);
    return {
      id: `argument-${index + 1}`,
      panelIds: normalizedEvidencePanelIds(source.panels),
      established: boundedText(source.established),
      handoff: boundedText(source.handoff),
      evidenceLevel: boundedText(source.evidenceLevel, 80)
    };
  }

  function normalizedLogicBridge(value, index) {
    const source = ownRecord(value, RESULT_LOGIC_BRIDGE_KEYS);
    return {
      id: `bridge-${index + 1}`,
      fromGroup: boundedText(source.fromGroup, 240),
      toGroup: boundedText(source.toGroup, 240),
      relationType: boundedText(source.relationType, 80),
      bridge: boundedText(source.bridge)
    };
  }

  function argumentOverlap(panelIds, groupPanelIds) {
    const group = new Set(groupPanelIds);
    let overlap = 0;
    for (const panelId of panelIds) if (group.has(panelId)) overlap += 1;
    return overlap;
  }

  function evidenceBlockFromArgument(step, index) {
    return {
      kind: 'evidence',
      id: `evidence-argument-${index + 1}`,
      sourceType: 'argument',
      panelIds: step.panelIds.slice(),
      groupGoal: '',
      groupConclusion: '',
      established: step.established,
      handoff: step.handoff,
      evidenceLevel: step.evidenceLevel,
      transitionToNext: '',
      argumentSteps: [{ ...step, panelIds: step.panelIds.slice() }],
      logicBridges: []
    };
  }

  function evidenceBlockFromBridge(bridge, index, fromBlock = null, toBlock = null) {
    return {
      kind: 'evidence',
      id: `evidence-bridge-${index + 1}`,
      sourceType: 'bridge',
      fromBlockId: fromBlock?.id || '',
      toBlockId: toBlock?.id || '',
      fromGroup: bridge.fromGroup,
      toGroup: bridge.toGroup,
      panelIds: [],
      groupGoal: [bridge.fromGroup, bridge.toGroup].filter(Boolean).join(' → '),
      groupConclusion: '',
      established: '',
      handoff: '',
      evidenceLevel: bridge.relationType,
      transitionToNext: bridge.bridge,
      argumentSteps: [],
      logicBridges: [{ ...bridge }]
    };
  }

  function transitionFromBridge(bridge, fromBlock, toBlock) {
    return {
      kind: 'transition',
      id: `evidence-transition-${bridge.id}`,
      sourceType: 'bridge',
      fromBlockId: fromBlock.id,
      toBlockId: toBlock.id,
      fromGroup: bridge.fromGroup,
      toGroup: bridge.toGroup,
      relationType: bridge.relationType,
      established: fromBlock.established || fromBlock.groupConclusion,
      handoff: fromBlock.handoff,
      nextGoal: toBlock.groupGoal,
      transitionToNext: bridge.bridge || fromBlock.handoff,
      logicBridges: [{ ...bridge }]
    };
  }

  function syntheticEvidenceTransition(fromBlock, toBlock, index) {
    return {
      kind: 'transition',
      id: `evidence-transition-handoff-${index + 1}`,
      sourceType: 'argument',
      fromBlockId: fromBlock.id,
      toBlockId: toBlock.id,
      fromGroup: fromBlock.groupGoal || fromBlock.groupConclusion,
      toGroup: toBlock.groupGoal || toBlock.groupConclusion,
      relationType: '',
      established: fromBlock.established || fromBlock.groupConclusion,
      handoff: fromBlock.handoff,
      nextGoal: toBlock.groupGoal,
      transitionToNext: fromBlock.handoff,
      logicBridges: []
    };
  }

  function buildEvidenceBlocks(result) {
    return withNormalizationBudget(() => {
      const source = ownRecord(result, EVIDENCE_RESULT_KEYS);
      const groupBlocks = cappedArrayValues(source.panelGroups, MAX_RESULT_PANEL_GROUPS)
        .map((value, index) => {
          const group = ownRecord(value, RESULT_PANEL_GROUP_KEYS);
          return {
            kind: 'evidence',
            id: `evidence-group-${index + 1}`,
            sourceType: 'group',
            panelIds: normalizedEvidencePanelIds(group.panels),
            groupGoal: boundedText(group.groupGoal),
            groupConclusion: boundedText(group.groupConclusion),
            upstreamContext: boundedText(group.upstreamContext),
            established: '',
            handoff: '',
            evidenceLevel: '',
            transitionToNext: '',
            argumentSteps: [],
            logicBridges: []
          };
        })
        .filter(block => block.panelIds.length || block.groupGoal || block.groupConclusion);
      const aliases = groupBlocks.map(evidenceGroupAliases);
      const unmatchedArguments = [];

      cappedArrayValues(source.argumentChain, MAX_RESULT_ARGUMENT_STEPS)
        .forEach((value, index) => {
          const step = normalizedArgumentStep(value, index);
          if (!step.panelIds.length && !step.established && !step.handoff) return;
          let matchIndex = -1;
          let maximumOverlap = 0;
          groupBlocks.forEach((block, blockIndex) => {
            const overlap = argumentOverlap(step.panelIds, block.panelIds);
            if (overlap > maximumOverlap) {
              maximumOverlap = overlap;
              matchIndex = blockIndex;
            }
          });
          if (matchIndex < 0) {
            unmatchedArguments.push(evidenceBlockFromArgument(step, index));
            return;
          }
          const block = groupBlocks[matchIndex];
          block.argumentSteps.push({ ...step, panelIds: step.panelIds.slice() });
          block.established = joinedEvidenceText(
            block.argumentSteps.map(item => item.established)
          );
          block.handoff = joinedEvidenceText(block.argumentSteps.map(item => item.handoff));
          block.evidenceLevel = joinedEvidenceText(
            block.argumentSteps.map(item => item.evidenceLevel)
          );
        });

      const transitionsBySourceBlock = new Map();
      const standaloneBridgesBySource = new Map();
      const unresolvedBridges = [];
      cappedArrayValues(source.logicBridges, MAX_RESULT_LOGIC_BRIDGES)
        .forEach((value, index) => {
          const bridge = normalizedLogicBridge(value, index);
          if (!bridge.fromGroup && !bridge.toGroup && !bridge.bridge) return;
          const fromLabel = normalizeEvidenceGroupLabel(bridge.fromGroup);
          const toLabel = normalizeEvidenceGroupLabel(bridge.toGroup);
          const fromIndex = aliases.findIndex(values => values.has(fromLabel));
          const toIndex = aliases.findIndex(values => values.has(toLabel));
          const fromBlock = fromIndex >= 0 ? groupBlocks[fromIndex] : null;
          const toBlock = toIndex >= 0 ? groupBlocks[toIndex] : null;
          if (!fromBlock || !toBlock || toIndex !== fromIndex + 1) {
            const standalone = evidenceBlockFromBridge(
              bridge, index, fromBlock, toBlock
            );
            if (fromBlock) {
              const blocks = standaloneBridgesBySource.get(fromBlock.id) || [];
              blocks.push(standalone);
              standaloneBridgesBySource.set(fromBlock.id, blocks);
            } else {
              unresolvedBridges.push(standalone);
            }
            return;
          }
          fromBlock.logicBridges.push({ ...bridge });
          const transitions = transitionsBySourceBlock.get(fromBlock.id) || [];
          transitions.push(transitionFromBridge(bridge, fromBlock, toBlock));
          transitionsBySourceBlock.set(fromBlock.id, transitions);
        });

      for (let index = 0; index < groupBlocks.length - 1; index += 1) {
        const current = groupBlocks[index];
        const next = groupBlocks[index + 1];
        const transitions = transitionsBySourceBlock.get(current.id) || [];
        const directlyBridged = transitions.some(item =>
          item.fromBlockId === current.id && item.toBlockId === next.id
        );
        if (!directlyBridged && current.handoff) {
          transitions.push(syntheticEvidenceTransition(current, next, index));
          transitionsBySourceBlock.set(current.id, transitions);
        }
      }

      const layout = [];
      groupBlocks.forEach((block, index) => {
        layout.push(block);
        layout.push(...(transitionsBySourceBlock.get(block.id) || []));
        layout.push(...(standaloneBridgesBySource.get(block.id) || []));
      });
      layout.push(...unmatchedArguments, ...unresolvedBridges);
      // Reserve space for real experiment blocks before optional bridge metadata.
      const evidenceCount = layout.filter(item => item.kind === 'evidence' && item.sourceType !== 'bridge').length;
      let metadataSlots = Math.max(0, MAX_COLLECTION_ITEMS - evidenceCount);
      return layout.filter(item => (item.kind === 'evidence' && item.sourceType !== 'bridge') || metadataSlots-- > 0)
        .slice(0, MAX_COLLECTION_ITEMS);
    });
  }

  function normalizeEvidenceBlocks(value, legacyIsHumanReviewed = true) {
    const blocks = [];
    for (const rawBlock of cappedArrayValues(value, MAX_COLLECTION_ITEMS)) {
      if (!isPlainObject(rawBlock)) continue;
      const source = ownRecord(rawBlock, EVIDENCE_BLOCK_KEYS);
      const id = safeId(source.id, 80);
      if (!id || blocks.some(block => block.id === id)) continue;
      const panelIds = cappedArrayValues(source.panelIds, MAX_PANEL_IDS_PER_BLOCK)
        .map(safePanelId).filter(Boolean);
      const kind = source.kind === 'transition' ? 'transition' : 'evidence';
      const sourceType = ['group', 'argument', 'bridge', 'manual']
        .includes(source.sourceType) ? source.sourceType : 'manual';
      const block = {
        id,
        ...optionalDisplayName(source, legacyIsHumanReviewed !== false),
        kind,
        sourceType,
        panelIds,
        fromBlockId: safeId(source.fromBlockId, 80),
        toBlockId: safeId(source.toBlockId, 80)
      };
      for (const field of EVIDENCE_SCALAR_FIELDS) {
        block[field] = normalizedEditable(source[field], legacyIsHumanReviewed);
      }
      if (legacyIsHumanReviewed !== false && source.provenance === 'manual') {
        block.provenance = 'manual';
        block.sourceType = 'manual';
        for (const field of MANUAL_EVIDENCE_FIELDS) block[field] = normalizedEditable(source[field], true);
        if (['group', 'argument', 'bridge', 'manual'].includes(source.originalSourceType)) {
          block.originalSourceType = source.originalSourceType;
          block.originalPanelIds = [...new Set(cappedArrayValues(source.originalPanelIds, MAX_PANEL_IDS_PER_BLOCK).map(safePanelId).filter(Boolean))];
          const history = ownRecord(source.originalSource, ['kind', 'sourceType', 'panelIds', ...EVIDENCE_SCALAR_FIELDS]);
          if (history.sourceType === block.originalSourceType) {
            block.originalSource = {
              kind: history.kind === 'transition' ? 'transition' : 'evidence',
              sourceType: block.originalSourceType, panelIds: block.originalPanelIds.slice()
            };
            for (const field of EVIDENCE_SCALAR_FIELDS) block.originalSource[field] = normalizedEditable(history[field], false);
          }
        }
      }
      blocks.push(block);
    }
    return blocks;
  }

  function evidenceBlockHasHumanReview(block) {
    return [...EVIDENCE_SCALAR_FIELDS, 'displayName'].some(field => block?.[field]?.humanReviewed === true);
  }

  function normalizeEvidenceBlockTombstones(value) {
    const seen = new Set();
    // Model ordinal IDs can be reused for different groups. Tombstone identity
    // follows the complete original group, rather than that mutable ordinal.
    return cappedArrayValues(value, MAX_COLLECTION_ITEMS).map(raw => normalizeEvidenceBlocks([raw])[0]).filter(block => {
      const identity = regeneratableEvidenceBlockIdentity(block);
      if (!identity || seen.has(identity)) return false;
      seen.add(identity); return true;
    });
  }

  function normalizeManualEvidenceArchive(value, figureLabel, isSupplemental) {
    const result = [], used = new Set();
    for (const raw of cappedArrayValues(value, MAX_COLLECTION_ITEMS)) {
      const source = ownRecord(raw, ['id', 'blockId', 'mergedIntoBlockId', 'mergedAt', 'block', 'panels']);
      const id = safeId(source.id, 80), blockId = safeId(source.blockId, 80), targetId = safeId(source.mergedIntoBlockId, 80);
      const block = normalizeEvidenceBlocks([source.block])[0];
      if (!id || !blockId || !targetId || used.has(id) || !block || block.id !== blockId) continue;
      const members = normalizePanels(source.panels, figureLabel, true, isSupplemental), panels = createSafeMap();
      for (const panelId of block.panelIds) if (Object.hasOwn(members, panelId)) panels[panelId] = members[panelId];
      used.add(id);
      result.push({ id, blockId, mergedIntoBlockId: targetId, mergedAt: boundedTimestamp(source.mergedAt), block, panels });
    }
    return result;
  }

  function mergeManualEvidenceArchives(existingValue, incomingValue, figureLabel, isSupplemental) {
    const existing = normalizeManualEvidenceArchive(existingValue, figureLabel, isSupplemental);
    const incoming = normalizeManualEvidenceArchive(incomingValue, figureLabel, isSupplemental);
    const result = existing.slice(), used = new Set(existing.map(entry => entry.id));
    for (const entry of incoming) {
      const prior = result.find(item => item.id === entry.id);
      if (prior && JSON.stringify(prior) === JSON.stringify(entry)) continue;
      if (result.length >= MAX_COLLECTION_ITEMS) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      result.push({ ...entry, id: allocateEvidenceBlockId(entry.id, used) });
    }
    return result;
  }

  function mergeEvidenceBlockRecords(existing, incoming, regenerate = false) {
    if (existing.provenance === 'manual') return { ...existing, panelIds: existing.panelIds.slice() };
    const merged = {
      ...incoming,
      ...mergeDisplayNames(existing, incoming),
      id: existing.id,
      kind: existing.kind || incoming.kind,
      sourceType: existing.sourceType === 'manual' ? 'manual' : incoming.sourceType,
      panelIds: existing.sourceType === 'manual'
        ? existing.panelIds.slice() : incoming.panelIds.slice(),
      fromBlockId: existing.sourceType === 'manual'
        ? existing.fromBlockId : incoming.fromBlockId,
      toBlockId: existing.sourceType === 'manual'
        ? existing.toBlockId : incoming.toBlockId
    };
    for (const field of EVIDENCE_SCALAR_FIELDS) {
      const prior = existing[field] || editableValue();
      const generated = incoming[field] || editableValue();
      merged[field] = prior.humanReviewed
        ? prior
        : regenerate ? generated : mergeEditableValues(prior, generated);
    }
    return merged;
  }

  function isRegeneratableEvidenceBlock(block) {
    return block?.kind === 'evidence' &&
      ['group', 'argument'].includes(block?.sourceType);
  }

  function regeneratableEvidenceBlockIdentity(block) {
    if (!isRegeneratableEvidenceBlock(block)) return '';
    const panelIds = [...new Set(
      (Array.isArray(block.panelIds) ? block.panelIds : [])
        .map(safePanelId).filter(Boolean)
    )].sort();
    return panelIds.length
      ? `${block.kind}\u0000${block.sourceType}\u0000${panelIds.join('\u0000')}`
      : '';
  }

  function uniqueEvidenceBlockIdentityIndex(blocks) {
    const byIdentity = new Map();
    const duplicates = new Set();
    blocks.forEach((block, index) => {
      const identity = regeneratableEvidenceBlockIdentity(block);
      if (!identity || duplicates.has(identity)) return;
      if (byIdentity.has(identity)) {
        byIdentity.delete(identity);
        duplicates.add(identity);
      } else {
        byIdentity.set(identity, index);
      }
    });
    return byIdentity;
  }

  function isRegeneratableRelationBlock(block) {
    return block?.kind === 'transition' || block?.sourceType === 'bridge';
  }

  function regeneratableRelationBlockIdentity(block) {
    if (!isRegeneratableRelationBlock(block)) return '';
    const fromBlockId = safeId(block.fromBlockId, 80);
    const toBlockId = safeId(block.toBlockId, 80);
    return fromBlockId && toBlockId
      ? `${block.kind}\u0000${block.sourceType}\u0000${fromBlockId}\u0000${toBlockId}`
      : '';
  }

  function uniqueRelationBlockIdentityIndex(blocks) {
    const byIdentity = new Map();
    const duplicates = new Set();
    blocks.forEach((block, index) => {
      const identity = regeneratableRelationBlockIdentity(block);
      if (!identity || duplicates.has(identity)) return;
      if (byIdentity.has(identity)) {
        byIdentity.delete(identity);
        duplicates.add(identity);
      } else {
        byIdentity.set(identity, index);
      }
    });
    return byIdentity;
  }

  function allocateEvidenceBlockId(preferredId, usedIds) {
    const preferred = safeId(preferredId, 80) || 'evidence-block';
    if (!usedIds.has(preferred)) {
      usedIds.add(preferred);
      return preferred;
    }
    for (let index = 2; index <= MAX_COLLECTION_ITEMS + 1; index += 1) {
      const suffix = `-${index}`;
      const candidate = `${preferred.slice(0, 80 - suffix.length)}${suffix}`;
      if (!usedIds.has(candidate)) {
        usedIds.add(candidate);
        return candidate;
      }
    }
    return '';
  }

  function remapEvidenceBlockEndpoints(block, idMap) {
    return {
      ...block,
      fromBlockId: idMap.get(block.fromBlockId) || block.fromBlockId,
      toBlockId: idMap.get(block.toBlockId) || block.toBlockId
    };
  }

  function mergeEvidenceBlockCollections(existingValue, incomingValue, regenerate = false, tombstoneValue = []) {
    const replacedIdentities = new Set(normalizeEvidenceBlockTombstones(tombstoneValue).map(regeneratableEvidenceBlockIdentity));
    const eligible = block => !replacedIdentities.has(regeneratableEvidenceBlockIdentity(block));
    const existing = normalizeEvidenceBlocks(existingValue).filter(eligible);
    const protectedManual = existing.filter(block => block.provenance === 'manual');
    let incoming = normalizeEvidenceBlocks(incomingValue, !regenerate).filter(eligible)
      .slice(0, MAX_COLLECTION_ITEMS - protectedManual.length);
    if (!regenerate && protectedManual.length) {
      const protectedIds = new Set(protectedManual.map(block => block.id));
      const usedIds = new Set([...protectedIds, ...incoming.map(block => block.id)]), idMap = new Map();
      incoming = incoming.map(block => {
        if (!protectedIds.has(block.id) || block.provenance === 'manual') return block;
        const renamed = allocateEvidenceBlockId(block.id, usedIds);
        idMap.set(block.id, renamed);
        return { ...block, id: renamed };
      }).map(block => remapEvidenceBlockEndpoints(block, idMap));
    }
    if (regenerate) {
      const existingIdentityIndex = uniqueEvidenceBlockIdentityIndex(existing);
      const incomingIdentityIndex = uniqueEvidenceBlockIdentityIndex(incoming);
      const matchedExistingByIncoming = new Map();
      const consumedExisting = new Set();

      for (const [identity, incomingIndex] of incomingIdentityIndex) {
        if (!existingIdentityIndex.has(identity)) continue;
        const existingIndex = existingIdentityIndex.get(identity);
        matchedExistingByIncoming.set(incomingIndex, existingIndex);
        consumedExisting.add(existingIndex);
      }

      const usedIds = new Set(protectedManual.map(block => block.id));
      const incomingFinalIds = new Map();
      for (const [incomingIndex, existingIndex] of matchedExistingByIncoming) {
        incomingFinalIds.set(incomingIndex, allocateEvidenceBlockId(
          existing[existingIndex].id, usedIds
        ));
      }
      incoming.forEach((block, index) => {
        if (!incomingFinalIds.has(index) && !isRegeneratableRelationBlock(block)) {
          incomingFinalIds.set(index, allocateEvidenceBlockId(block.id, usedIds));
        }
      });

      const endpointIdMap = new Map();
      incoming.forEach((block, index) => {
        if (incomingFinalIds.has(index)) {
          endpointIdMap.set(block.id, incomingFinalIds.get(index));
        }
      });
      const remappedIncoming = incoming.map(block =>
        remapEvidenceBlockEndpoints(block, endpointIdMap)
      );
      const existingRelationIndex = uniqueRelationBlockIdentityIndex(existing);
      const incomingRelationIndex = uniqueRelationBlockIdentityIndex(remappedIncoming);
      for (const [identity, incomingIndex] of incomingRelationIndex) {
        if (!existingRelationIndex.has(identity)) continue;
        const existingIndex = existingRelationIndex.get(identity);
        if (consumedExisting.has(existingIndex)) continue;
        matchedExistingByIncoming.set(incomingIndex, existingIndex);
        consumedExisting.add(existingIndex);
        incomingFinalIds.set(incomingIndex, allocateEvidenceBlockId(
          existing[existingIndex].id, usedIds
        ));
      }
      incoming.forEach((block, index) => {
        if (!incomingFinalIds.has(index)) {
          incomingFinalIds.set(index, allocateEvidenceBlockId(block.id, usedIds));
        }
      });

      const incomingIdMap = new Map();
      incoming.forEach((block, index) => incomingIdMap.set(block.id, incomingFinalIds.get(index)));
      const merged = incoming.map((block, index) => {
        const matchedIndex = matchedExistingByIncoming.get(index);
        let prior = matchedIndex === undefined ? null : existing[matchedIndex];
        if (!isRegeneratableEvidenceBlock(block) &&
            !isRegeneratableRelationBlock(block) && !prior) {
          const sameIdIndex = existing.findIndex((candidate, candidateIndex) =>
            !consumedExisting.has(candidateIndex) && candidate.provenance !== 'manual' && candidate.id === block.id
          );
          if (sameIdIndex >= 0) {
            prior = existing[sameIdIndex];
            consumedExisting.add(sameIdIndex);
          }
        }
        const next = prior ? mergeEvidenceBlockRecords(prior, block, true) : block;
        return { ...next, id: incomingFinalIds.get(index) };
      }).map(block => remapEvidenceBlockEndpoints(block, incomingIdMap));

      const retainedExisting = [];
      const existingIdMap = new Map();
      existing.map((block, index) => ({ block, index }))
        .sort((left, right) => Number(right.block.provenance === 'manual') - Number(left.block.provenance === 'manual'))
        .forEach(({ block, index }) => {
        if (consumedExisting.has(index) ||
            (block.sourceType !== 'manual' && !evidenceBlockHasHumanReview(block)) ||
            merged.length + retainedExisting.length >= MAX_COLLECTION_ITEMS) return;
        const retainedId = block.provenance === 'manual' ? block.id : allocateEvidenceBlockId(block.id, usedIds);
        if (!retainedId) return;
        existingIdMap.set(block.id, retainedId);
        retainedExisting.push({ ...block, id: retainedId });
      });
      merged.push(...retainedExisting.map(block =>
        remapEvidenceBlockEndpoints(block, existingIdMap)
      ));
      return merged;
    }
    const incomingIds = new Set(incoming.map(block => block.id));
    const merged = incoming.map(block => {
      const prior = existing.find(candidate => candidate.id === block.id);
      return prior ? mergeEvidenceBlockRecords(prior, block, regenerate) : block;
    });
    for (const block of existing) {
      if (incomingIds.has(block.id) || merged.length >= MAX_COLLECTION_ITEMS) continue;
      if (!regenerate || block.sourceType === 'manual' || evidenceBlockHasHumanReview(block)) {
        merged.push(block);
      }
    }
    return merged;
  }

  function boundedSupplementalPlacementIndex(value) {
    const type = typeof value;
    if (!['string', 'number', 'boolean', 'bigint'].includes(type)) return 0;
    if (type === 'string' && value.length > 32) return 0;
    let number;
    try { number = Number(value); } catch (_) { return 0; }
    if (number === Infinity) return MAX_COLLECTION_ITEMS;
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(MAX_COLLECTION_ITEMS, Math.floor(number)));
  }

  function normalizeSupplementalPlacements(value) {
    const placements = [];
    const seen = new Set();
    for (const rawPlacement of cappedArrayValues(value, MAX_COLLECTION_ITEMS)) {
      if (!isPlainObject(rawPlacement)) continue;
      const source = ownRecord(rawPlacement, PLACEMENT_KEYS);
      const figureId = safeId(source.figureId);
      if (!figureId || seen.has(figureId)) continue;
      seen.add(figureId);
      placements.push({
        figureId,
        slot: boundedSupplementalPlacementIndex(source.slot),
        rank: boundedSupplementalPlacementIndex(source.rank)
      });
    }
    return placements;
  }

  function displayOrderPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_) { return false; }
  }

  function displayOrderArray(value) {
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Array.prototype && prototype !== null) return null;
    } catch (_) { return null; }
    return strictGeneratedArray(value, MAX_FIGURES);
  }

  function displayOrderId(value) {
    return typeof value === 'string' && value.length <= MAX_ID_LENGTH &&
      safeId(value) === value ? value : '';
  }

  // Storage/display recovery rejects an entire malformed sequence. Removed IDs
  // may be filtered by the caller, but duplicates and coercions are never repaired.
  function readFigureDisplayOrder(value) {
    const values = displayOrderArray(value);
    if (!values) return null;
    const seen = new Set();
    for (const id of values) {
      if (!displayOrderId(id) || seen.has(id)) return null;
      seen.add(id);
    }
    return values;
  }

  function readFigureDisplayInventory(value) {
    const rows = displayOrderArray(value);
    const ids = [];
    if (!rows) throw workspaceError('FIGURE_WORKSPACE_DISPLAY_ORDER_INVENTORY_INVALID');
    for (const row of rows) {
      const source = displayOrderPlainObject(row)
        ? strictOwnDataRecord(row, ['figureId'], ['id']) : null;
      const id = source && displayOrderId(source.figureId);
      if (!id || ids.includes(id) ||
          (Object.hasOwn(source, 'id') && source.id !== id)) {
        throw workspaceError('FIGURE_WORKSPACE_DISPLAY_ORDER_INVENTORY_INVALID');
      }
      ids.push(id);
    }
    return ids;
  }

  function validateFigureDisplayOrderMutation(draft, rawMutation, mutation, options) {
    const order = displayOrderPlainObject(rawMutation)
      ? readFigureDisplayOrder(mutation.figureIds) : null;
    if (!order) throw workspaceError('FIGURE_WORKSPACE_DISPLAY_ORDER_INVALID');
    const source = ownRecord(options, ['inventory']);
    if (!Object.hasOwn(source, 'inventory')) {
      throw workspaceError('FIGURE_WORKSPACE_DISPLAY_ORDER_INVENTORY_REQUIRED');
    }
    const inventoryIds = readFigureDisplayInventory(source.inventory);
    if (inventoryIds.some(id => !Object.hasOwn(draft.figures, id)) ||
        (order.length && (order.length !== inventoryIds.length ||
          order.some(id => !inventoryIds.includes(id))))) {
      throw workspaceError('FIGURE_WORKSPACE_DISPLAY_ORDER_INVENTORY_MISMATCH');
    }
    return order;
  }

  function orderFigureWorkspaceItems(value, rawPlacements, rawDisplayOrder) {
    const items = cappedArrayValues(value, MAX_FIGURES).map((figure, sourceIndex) => {
      const source = ownRecord(figure, FIGURE_KEYS);
      return {
        figure,
        sourceIndex,
        figureId: safeId(source.figureId || source.id),
        label: boundedText(source.figureLabel || source.label, 240),
        isSupplemental: source.isSupplemental === true,
        mainNumber: null,
        mainSuffix: ''
      };
    });
    const naturalOrder = (left, right) =>
      left.label.localeCompare(right.label, undefined, {
        numeric: true, sensitivity: 'base'
      }) || left.figureId.localeCompare(right.figureId, undefined, {
        numeric: true, sensitivity: 'base'
      }) || left.sourceIndex - right.sourceIndex;
    items.forEach(item => {
      if (item.isSupplemental) return;
      const labelMatch = /^\s*(?:main\s+)?(?:figure|fig\.?)\s*[-:#]?\s*(\d{1,6})(?:\s*([a-z]))?/iu
        .exec(item.label);
      const idMatch = /^(?:main[-_.:]*)?(?:figure|fig)[-_.:]*(\d{1,6})(?:[-_.:]*([a-z]))?$/iu
        .exec(item.figureId);
      const match = labelMatch || idMatch;
      if (!match) return;
      item.mainNumber = Number(match[1]);
      item.mainSuffix = String(match[2] || '').toUpperCase();
    });
    const mainOrder = (left, right) => {
      const leftNumbered = Number.isSafeInteger(left.mainNumber);
      const rightNumbered = Number.isSafeInteger(right.mainNumber);
      if (leftNumbered && rightNumbered) {
        return left.mainNumber - right.mainNumber ||
          left.mainSuffix.localeCompare(right.mainSuffix, undefined, {
            numeric: true, sensitivity: 'base'
          }) || naturalOrder(left, right);
      }
      if (leftNumbered) return -1;
      if (rightNumbered) return 1;
      return naturalOrder(left, right);
    };
    const main = items.filter(item => !item.isSupplemental).sort(mainOrder);
    const supplemental = items.filter(item => item.isSupplemental);
    const figureIdCounts = new Map();
    items.forEach(item => {
      if (!item.figureId) return;
      figureIdCounts.set(item.figureId, (figureIdCounts.get(item.figureId) || 0) + 1);
    });
    const placementById = new Map(normalizeSupplementalPlacements(rawPlacements)
      .filter(placement => figureIdCounts.get(placement.figureId) === 1)
      .map((placement, placementIndex) => [
        placement.figureId, { ...placement, placementIndex }
      ]));
    const buckets = Array.from({ length: main.length + 1 }, () => []);
    supplemental.forEach(item => {
      const placement = placementById.get(item.figureId);
      const slot = placement
        ? Math.min(main.length, placement.slot) : main.length;
      buckets[slot].push({ item, placement });
    });
    buckets.forEach(bucket => bucket.sort((left, right) => {
      if (left.placement && right.placement) {
        return left.placement.rank - right.placement.rank ||
          left.placement.placementIndex - right.placement.placementIndex ||
          naturalOrder(left.item, right.item);
      }
      if (left.placement) return -1;
      if (right.placement) return 1;
      return naturalOrder(left.item, right.item);
    }));
    const ordered = [];
    for (let slot = 0; slot <= main.length; slot += 1) {
      ordered.push(...buckets[slot].map(entry => entry.item.figure));
      if (slot < main.length) ordered.push(main[slot].figure);
    }
    const displayOrder = readFigureDisplayOrder(rawDisplayOrder);
    if (!displayOrder?.length) return ordered;
    // Keep all ambiguous source entries in their legacy relative order. Only
    // a unique stable ID may be moved; ordering never merges source records.
    const movable = new Map(items.filter(item => figureIdCounts.get(item.figureId) === 1)
      .map(item => [item.figureId, item.figure]));
    const preferred = displayOrder.filter(id => movable.has(id)).map(id => movable.get(id));
    const placed = new Set(preferred);
    return [...preferred, ...ordered.filter(figure => !placed.has(figure))];
  }

  function panelEvidenceMatches(figures, displayValue) {
    const matches = [];
    for (const [figureId, figure] of cappedMapEntries(figures, MAX_FIGURES)) {
      for (const [panelId, panel] of cappedMapEntries(
        figure?.panels, MAX_PANELS_PER_FIGURE
      )) {
        if (panel?.compactId === displayValue) matches.push({ figureId, panelId });
      }
    }
    return matches;
  }

  function normalizePanelEvidence(value, figures) {
    const editable = normalizedEditable(value);
    const source = ownRecord(value, PANEL_EVIDENCE_KEYS);
    const hasIdentity = Object.hasOwn(source, 'figureId') || Object.hasOwn(source, 'panelId');
    const hasResolutionMarker = Object.hasOwn(source, 'unresolved');
    let figureId = safeId(source.figureId);
    let panelId = safePanelId(source.panelId);
    const exactFigure = figureId && Object.hasOwn(figures, figureId)
      ? figures[figureId] : null;
    const exactPanel = exactFigure && panelId && Object.hasOwn(exactFigure.panels, panelId)
      ? exactFigure.panels[panelId] : null;
    let displayValue = exactPanel
      ? mechanismCompactPanelId(exactFigure, exactFigure.figureLabel, panelId)
      : editable.value;
    let unresolved = source.unresolved === true;
    if (unresolved) {
      figureId = '';
      panelId = '';
    } else if (!figureId || !panelId) {
      figureId = '';
      panelId = '';
      unresolved = true;
      // Only schema-less legacy display values may be inferred. Once an
      // ambiguous value has been normalized with `unresolved: true`, later
      // inventory changes cannot silently bind it to another Panel.
      if (!hasIdentity && !hasResolutionMarker) {
        const matches = panelEvidenceMatches(figures, displayValue);
        if (matches.length === 1) {
          figureId = matches[0].figureId;
          panelId = matches[0].panelId;
          displayValue = figures[figureId].panels[panelId].compactId;
          unresolved = false;
        }
      }
    }
    const evidenceClass = explicitMechanismEvidenceClass(source.evidenceClass);
    const evidenceClassSource = explicitMechanismEvidenceClassSource(
      source.evidenceClassSource
    );
    return {
      figureId,
      panelId,
      value: displayValue,
      unresolved,
      ...(evidenceClass ? { evidenceClass } : {}),
      ...(evidenceClassSource ? { evidenceClassSource } : {}),
      humanReviewed: editable.humanReviewed,
      editedAt: editable.editedAt
    };
  }

  function normalizeMechanismGenerationIssues(value) {
    return cappedArrayValues(value, 16)
      .map(rawIssue => ownRecord(rawIssue, GENERATION_ISSUE_KEYS))
      .map(issue => ({
        code: boundedText(issue.code, 80),
        message: boundedText(issue.message, 240),
        edgeIndex: typeof issue.edgeIndex === 'number' &&
          Number.isSafeInteger(issue.edgeIndex) && issue.edgeIndex >= 0
          ? Math.min(MAX_COLLECTION_ITEMS - 1, issue.edgeIndex) : -1,
        edgeId: safeId(issue.edgeId, 80),
        displayId: mechanismPanelReference(issue.displayId)
      }))
      .filter(issue => issue.code && issue.message && issue.edgeId && issue.displayId);
  }

  function normalizeMechanismPanelAliases(value, figures, legacyReviewed = true) {
    const result = createSafeMap();
    for (const [key, alias] of cappedMapEntries(value, 512)) {
      const identity = resolvePanelKey(figures, key);
      if (!identity) continue;
      result[identity.panelKey] = normalizedEditable(alias, legacyReviewed);
    }
    return result;
  }

  function emptyMechanismReviewTombstones() {
    return { nodes: [], edges: [], evidence: [] };
  }

  function normalizeMechanismReviewTombstones(value) {
    const source = ownRecord(value, REVIEW_TOMBSTONE_KEYS);
    const result = emptyMechanismReviewTombstones();
    const nodeIds = new Set();
    for (const raw of cappedArrayValues(source.nodes, MAX_COLLECTION_ITEMS)) {
      const item = ownRecord(raw, NODE_TOMBSTONE_KEYS);
      const id = safeId(item.id, 80);
      if (!id || nodeIds.has(id)) continue;
      nodeIds.add(id);
      result.nodes.push({ id, editedAt: boundedTimestamp(item.editedAt) });
    }
    const edgeKeys = new Set();
    for (const raw of cappedArrayValues(source.edges, MAX_COLLECTION_ITEMS)) {
      const item = ownRecord(raw, EDGE_TOMBSTONE_KEYS);
      const id = safeId(item.id, 80);
      const from = safeId(item.from, 80);
      const to = safeId(item.to, 80);
      const key = `${id}\u0000${from}\u0000${to}`;
      if (!id || !from || !to || edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      result.edges.push({ id, from, to, editedAt: boundedTimestamp(item.editedAt) });
    }
    const evidenceKeys = new Set();
    for (const raw of cappedArrayValues(source.evidence, 512)) {
      const item = ownRecord(raw, EVIDENCE_TOMBSTONE_KEYS);
      const edgeId = safeId(item.edgeId, 80);
      const from = safeId(item.from, 80);
      const to = safeId(item.to, 80);
      const figureId = safeId(item.figureId, 160);
      const panelId = safePanelId(item.panelId);
      const key = `${edgeId}\u0000${from}\u0000${to}\u0000${figureId}\u0000${panelId}`;
      if (!edgeId || !from || !to || !figureId || !panelId || evidenceKeys.has(key)) continue;
      evidenceKeys.add(key);
      result.evidence.push({
        edgeId, from, to, figureId, panelId,
        editedAt: boundedTimestamp(item.editedAt)
      });
    }
    return result;
  }

  function normalizeMechanismPolarity(value) {
    return typeof value === 'string' && MECHANISM_POLARITIES.has(value)
      ? value : 'neutral';
  }

  function normalizeMechanismLayoutPreferences(value, nodeIds) {
    const source = ownRecord(value, [
      'pinnedRanks', 'siblingOrder', 'collapsedGroups'
    ]);
    const allowed = new Set(nodeIds);
    const pinnedRanks = {};
    const siblingOrder = {};
    for (const [key, target] of [
      ['pinnedRanks', pinnedRanks], ['siblingOrder', siblingOrder]
    ]) {
      for (const [rawId, rawValue] of cappedMapEntries(
        source[key], MAX_COLLECTION_ITEMS
      )) {
        const id = safeId(rawId, 80);
        if (!id || !allowed.has(id) || typeof rawValue !== 'number' ||
            !Number.isSafeInteger(rawValue) || rawValue < 0 || rawValue >= 64) continue;
        target[id] = rawValue;
      }
    }
    const seenGroups = new Set();
    const collapsedGroups = cappedArrayValues(source.collapsedGroups, 16)
      .filter(item => typeof item === 'string')
      .map(item => safeId(item, 80))
      .filter(id => id && !seenGroups.has(id) && seenGroups.add(id));
    return { pinnedRanks, siblingOrder, collapsedGroups };
  }

  function hasMechanismLayoutPreferences(value) {
    return Boolean(value && (
      Object.keys(value.pinnedRanks || {}).length ||
      Object.keys(value.siblingOrder || {}).length ||
      (value.collapsedGroups || []).length
    ));
  }

  function normalizedMechanismNodeLabel(value) {
    const raw = isPlainObject(value) ? ownRecord(value, EDITABLE_KEYS).value : value;
    const limit = activeNormalizationTextBudget ? Math.min(MAX_TEXT_LENGTH, activeNormalizationTextBudget.remaining) : MAX_TEXT_LENGTH;
    const normalized = normalizedEditable(value);
    if (typeof raw !== 'string' || !/[\r\n]/u.test(raw)) return normalized;
    const multiline = raw.slice(0, limit).normalize('NFKC').replace(/\r\n?/gu, '\n')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, ' ')
      .replace(/[^\S\n]+/gu, ' ').replace(/ *\n */gu, '\n').trim().slice(0, limit);
    // Preserve layout only when the existing sanitizer kept the same text.
    // Credential/URI removal and the shared normalization budget stay intact.
    if (multiline.replace(/\s+/gu, ' ').trim() !== normalized.value) return normalized;
    const extra = Math.max(0, multiline.length - normalized.value.length);
    if (activeNormalizationTextBudget) {
      if (extra > activeNormalizationTextBudget.remaining) return normalized;
      activeNormalizationTextBudget.remaining -= extra;
    }
    return { ...normalized, value: multiline };
  }

  function isCanonicalMechanismWorkspaceNodeLabel(value, maximum = MAX_TEXT_LENGTH) {
    if (typeof value !== 'string' || !Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_TEXT_LENGTH || value.length > maximum) return false;
    const previousBudget = activeNormalizationTextBudget;
    activeNormalizationTextBudget = null;
    try { return normalizedMechanismNodeLabel(value).value === value; }
    catch (_) { return false; }
    finally { activeNormalizationTextBudget = previousBudget; }
  }

  function normalizeMechanismChain(value, figures) {
    const source = ownRecord(value, CHAIN_KEYS);
    const nodes = [];
    const edges = [];
    for (const rawNode of cappedArrayValues(source.nodes, MAX_COLLECTION_ITEMS)) {
      if (!isPlainObject(rawNode)) continue;
      const node = ownRecord(rawNode, NODE_KEYS);
      const id = safeId(node.id, 80);
      if (!id || nodes.some(node => node.id === id)) continue;
      nodes.push({ id, label: normalizedMechanismNodeLabel(node.label) });
    }
    for (const rawEdge of cappedArrayValues(source.edges, MAX_COLLECTION_ITEMS)) {
      if (!isPlainObject(rawEdge)) continue;
      const edge = ownRecord(rawEdge, EDGE_KEYS);
      const id = safeId(edge.id, 80);
      if (!id || edges.some(edge => edge.id === id)) continue;
      const panelEvidence = cappedArrayValues(edge.panelEvidence, MAX_PANEL_IDS_PER_BLOCK)
        .map(item => normalizePanelEvidence(item, figures));
      edges.push({
        id,
        from: safeId(edge.from, 80),
        to: safeId(edge.to, 80),
        label: normalizedEditable(edge.label),
        polarity: normalizeMechanismPolarity(edge.polarity),
        panelEvidence,
        humanReviewed: edge.humanReviewed === true,
        editedAt: boundedTimestamp(edge.editedAt)
      });
    }
    const generationIssues = normalizeMechanismGenerationIssues(source.generationIssues);
    const panelAliases = normalizeMechanismPanelAliases(source.panelAliases, figures);
    const reviewTombstones = normalizeMechanismReviewTombstones(source.reviewTombstones);
    const layoutPreferences = normalizeMechanismLayoutPreferences(
      source.layoutPreferences, nodes.map(node => node.id)
    );
    const initialized = source.initialized === true || nodes.length > 0 || edges.length > 0;
    const drawing = source.drawing === undefined ? undefined
      : canvasContracts?.normalizeMechanismDrawing(source.drawing, { chain: { nodes, edges }, figures });
    return initialized
      ? {
          initialized: true, nodes, edges, panelAliases, reviewTombstones,
          ...(hasMechanismLayoutPreferences(layoutPreferences) ? { layoutPreferences } : {}),
          ...(drawing ? { drawing } : {}),
          ...(generationIssues.length ? { generationIssues } : {})
        }
      : {
          nodes, edges, panelAliases, reviewTombstones,
          ...(hasMechanismLayoutPreferences(layoutPreferences) ? { layoutPreferences } : {}),
          ...(drawing ? { drawing } : {})
        };
  }

  function normalizeFigureWorkspaceBinding(value) {
    if (!isPlainObject(value)) return null;
    const source = ownRecord(value, BINDING_KEYS);
    const bindingString = (input, maximum) => {
      if (typeof input !== 'string') return '';
      return input.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, '')
        .trim().slice(0, maximum);
    };
    const binding = {
      documentId: bindingString(source.documentId, MAX_ID_LENGTH),
      documentHash: bindingString(source.documentHash, MAX_ID_LENGTH),
      canonicalUrl: bindingString(source.canonicalUrl, 2000),
      workspaceId: bindingString(source.workspaceId, MAX_ID_LENGTH),
      workspaceGeneration: Number(source.workspaceGeneration)
    };
    if (!binding.documentId || !binding.documentHash || !binding.canonicalUrl ||
        !binding.workspaceId || !Number.isSafeInteger(binding.workspaceGeneration) ||
        binding.workspaceGeneration < 1) return null;
    return binding;
  }

  function sameFigureWorkspaceBinding(left, right) {
    const a = normalizeFigureWorkspaceBinding(left);
    const b = normalizeFigureWorkspaceBinding(right);
    return Boolean(a && b && BINDING_KEYS.every(key => a[key] === b[key]));
  }

  function strictGeneratedArray(value, maximum) {
    let array;
    try { array = Array.isArray(value); } catch (_) { return null; }
    if (!array) return null;
    let lengthDescriptor;
    try { lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length'); }
    catch (_) { return null; }
    const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
      ? lengthDescriptor.value : -1;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const result = [];
    for (let index = 0; index < length; index += 1) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); }
      catch (_) { return null; }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      result.push(descriptor.value);
    }
    return result;
  }

  function strictGeneratedText(value, maximum, pattern = null) {
    if (typeof value !== 'string' || !value || value.length > maximum) return '';
    const normalized = boundedText(value, maximum);
    if (!normalized || normalized !== value.trim()) return '';
    return pattern && !pattern.test(normalized) ? '' : normalized;
  }

  function normalizeGeneratedPanelKey(value) {
    const panelKey = strictGeneratedText(value, 100);
    return /^(?:figure-(?:(?:s)?\d+|ed\d+)(?:-[a-z0-9]+)*|supp-[a-z0-9]+(?:-[a-z0-9]+)*):(?:[A-Z]\d{0,2}|\d{1,2})$/u
      .test(panelKey) ? panelKey : '';
  }

  function normalizeGeneratedSourceRefs(value, panelKey) {
    const rows = strictGeneratedArray(value, 11);
    if (!rows?.length || !panelKey) return null;
    const result = rows.map(item => strictGeneratedText(item, 160));
    if (result.some((item, index) => {
      if (!item.startsWith(`${panelKey}:`) ||
          !GENERATED_SOURCE_FIELDS.has(item.slice(panelKey.length + 1))) return true;
      return index > 0 && result[index - 1] >= item;
    })) return null;
    return result;
  }

  function sameGeneratedStringArray(left, right) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }

  function generatedClaimRelationKind(claim) {
    if (claim.semantics === 'associational' &&
        !['no_change', 'mixed'].includes(claim.effectSign)) return 'correlative';
    if (claim.semantics === 'causal' &&
        ['necessity', 'sufficiency', 'rescue', 'epistasis',
          'directional_intervention'].includes(claim.causalTest) &&
        ['supports', 'refutes'].includes(claim.outcome) &&
        ['increases', 'decreases'].includes(claim.effectSign)) return 'causal';
    return '';
  }

  function generatedEvidenceClass(claim, role) {
    if (role !== 'supporting' || claim.outcome !== 'supports' ||
        generatedClaimRelationKind(claim) !== 'causal') return 'other';
    return ['necessity', 'sufficiency'].includes(claim.causalTest)
      ? claim.causalTest : 'other';
  }

  function normalizeGeneratedContext(value) {
    const source = ownRecord(value, GENERATED_CONTEXT_FIELDS);
    const context = {};
    for (const field of GENERATED_CONTEXT_FIELDS) {
      const item = source[field];
      if (typeof item !== 'string' || item.length > 240) return null;
      const normalized = boundedText(item, 240);
      if (normalized !== item.trim()) return null;
      context[field] = normalized;
    }
    return context;
  }

  function generatedRelationIdentityKey(sourceNodeId, targetNodeId, polarity, context) {
    return JSON.stringify([
      sourceNodeId, targetNodeId, polarity,
      ...GENERATED_CONTEXT_FIELDS.map(field => context[field])
    ]);
  }

  function generatedNodeDialect(value) {
    if (typeof value !== 'string') return null;
    return GENERATED_NODE_DIALECTS.find(dialect =>
      dialect.idPattern.test(value)
    ) || null;
  }

  function normalizeGeneratedMechanismPreview(value, expectedNodeDialect = '') {
    if (expectedNodeDialect && !GENERATED_NODE_DIALECTS.some(dialect =>
      dialect.version === expectedNodeDialect
    )) return null;
    const source = ownRecord(value, [
      'status', 'canonicalDigest', 'nodes', 'relations', 'claims',
      'claimUsages', 'nodeEvidence', 'nonGraphEvidence',
      'unresolvedClaims', 'panelDispositions'
    ]);
    const status = ['complete', 'needs_review'].includes(source.status)
      ? source.status : '';
    if (!status) return null;
    const canonicalDigest = strictGeneratedText(source.canonicalDigest, 100,
      new RegExp(`^${EVIDENCE_FIRST_VERSIONS.idAlgorithmVersion}-sha256-[a-f0-9]{64}$`, 'u'));
    const nodeRows = strictGeneratedArray(source.nodes, MAX_COLLECTION_ITEMS);
    const relationRows = strictGeneratedArray(source.relations, 64);
    const claimRows = strictGeneratedArray(source.claims, 1024);
    if (!canonicalDigest || !nodeRows?.length || !relationRows || !claimRows) return null;
    const nodes = [];
    const nodeIds = new Set();
    let nodeDialect = null;
    for (const raw of nodeRows) {
      const node = ownRecord(raw, ['nodeId', 'label', 'nodeType']);
      const nodeId = strictGeneratedText(node.nodeId, 80);
      const candidateDialect = generatedNodeDialect(nodeId);
      const label = strictGeneratedText(node.label, 240);
      if (!candidateDialect || (nodeDialect &&
          candidateDialect.version !== nodeDialect.version) ||
          (expectedNodeDialect && candidateDialect.version !== expectedNodeDialect)) {
        return null;
      }
      nodeDialect ||= candidateDialect;
      const nodeType = nodeDialect.nodeTypes.includes(node.nodeType)
        ? node.nodeType : '';
      if (!nodeId || !nodeDialect.idPattern.test(nodeId) || !label || !nodeType ||
          nodeIds.has(nodeId)) return null;
      nodeIds.add(nodeId);
      nodes.push({ nodeId, label, nodeType });
    }
    const claims = [];
    const claimIndex = new Map();
    for (const raw of claimRows) {
      const claim = ownRecord(raw, [
        'claimId', 'panelKey', 'semantics', 'causalTest', 'outcome',
        'effectSign', 'sourceAnalysisDigest', 'sourceRefs'
      ]);
      const claimId = strictGeneratedText(claim.claimId, 160,
        /^claim-v1-[a-f0-9]{16}$/u);
      const panelKey = normalizeGeneratedPanelKey(claim.panelKey);
      const semantics = ['causal', 'associational', 'descriptive']
        .includes(claim.semantics) ? claim.semantics : '';
      const causalTest = ['none', 'necessity', 'sufficiency', 'rescue',
        'epistasis', 'directional_intervention'].includes(claim.causalTest)
        ? claim.causalTest : '';
      const outcome = ['supports', 'refutes', 'mixed', 'inconclusive']
        .includes(claim.outcome) ? claim.outcome : '';
      const effectSign = ['increases', 'decreases', 'no_change', 'mixed', 'unknown']
        .includes(claim.effectSign) ? claim.effectSign : '';
      const sourceAnalysisDigest = strictGeneratedText(
        claim.sourceAnalysisDigest, 100, /^source-v2-[a-f0-9]{16}$/u
      );
      const sourceRefs = normalizeGeneratedSourceRefs(claim.sourceRefs, panelKey);
      if (!claimId || !panelKey || !semantics || !causalTest || !outcome ||
          !effectSign || !sourceAnalysisDigest ||
          !sourceRefs || claimIndex.has(claimId)) return null;
      const normalized = {
        claimId, panelKey, semantics, causalTest, outcome, effectSign,
        sourceAnalysisDigest, sourceRefs
      };
      claims.push(normalized);
      claimIndex.set(claimId, normalized);
    }
    const relations = [];
    const relationIds = new Set();
    const relationIdentities = new Set();
    let assignmentCount = 0;
    for (const raw of relationRows) {
      const relation = ownRecord(raw, [
        'relationId', 'sourceNodeId', 'targetNodeId', 'relationKind',
        'relationStatus', 'renderable', 'polarity', 'context', 'assignments'
      ]);
      const relationId = strictGeneratedText(relation.relationId, 160,
        /^relation-v1-[a-f0-9]{16}$/u);
      const sourceNodeId = strictGeneratedText(relation.sourceNodeId, 160,
        nodeDialect.idPattern);
      const targetNodeId = strictGeneratedText(relation.targetNodeId, 160,
        nodeDialect.idPattern);
      const relationKind = ['causal', 'correlative'].includes(relation.relationKind)
        ? relation.relationKind : '';
      const relationStatus = ['supported', 'counter_only'].includes(
        relation.relationStatus
      ) ? relation.relationStatus : '';
      const polarity = ['increases', 'decreases', 'no_change', 'mixed', 'unknown']
        .includes(relation.polarity) ? relation.polarity : '';
      const context = normalizeGeneratedContext(relation.context);
      const assignmentRows = strictGeneratedArray(relation.assignments, 1024);
      if (!relationId || !sourceNodeId || !targetNodeId ||
          sourceNodeId === targetNodeId || !nodeIds.has(sourceNodeId) ||
          !nodeIds.has(targetNodeId) || !relationKind || !relationStatus || !polarity ||
          !context || !assignmentRows?.length || relationIds.has(relationId)) return null;
      const relationIdentity = generatedRelationIdentityKey(
        sourceNodeId, targetNodeId, polarity, context
      );
      if (relationIdentities.has(relationIdentity)) return null;
      assignmentCount += assignmentRows.length;
      if (assignmentCount > 1024) return null;
      const assignments = [];
      for (const rawAssignment of assignmentRows) {
        const assignment = ownRecord(rawAssignment, [
          'claimId', 'panelKey', 'evidenceClass', 'role',
          'claimRelationKind', 'sourceRefs'
        ]);
        const claimId = strictGeneratedText(assignment.claimId, 160,
          /^claim-v1-[a-f0-9]{16}$/u);
        const panelKey = normalizeGeneratedPanelKey(assignment.panelKey);
        const evidenceClass = ['sufficiency', 'necessity', 'other']
          .includes(assignment.evidenceClass) ? assignment.evidenceClass : '';
        const role = ['supporting', 'counterclaim'].includes(assignment.role)
          ? assignment.role : '';
        const claimRelationKind = ['causal', 'correlative'].includes(
          assignment.claimRelationKind
        ) ? assignment.claimRelationKind : '';
        const sourceRefs = normalizeGeneratedSourceRefs(
          assignment.sourceRefs, panelKey
        );
        const canonicalClaim = claimIndex.get(claimId);
        if (!claimId || !panelKey || !evidenceClass || !role ||
            !claimRelationKind || !sourceRefs || !canonicalClaim ||
            canonicalClaim.panelKey !== panelKey ||
            canonicalClaim.outcome !== (role === 'supporting' ? 'supports' : 'refutes') ||
            canonicalClaim.effectSign !== polarity ||
            generatedClaimRelationKind(canonicalClaim) !== claimRelationKind ||
            generatedEvidenceClass(canonicalClaim, role) !== evidenceClass ||
            !sameGeneratedStringArray(sourceRefs, canonicalClaim.sourceRefs)) return null;
        assignments.push({
          claimId, panelKey, evidenceClass, role, claimRelationKind, sourceRefs
        });
      }
      const supporting = assignments.filter(item => item.role === 'supporting');
      const counterclaims = assignments.filter(item => item.role === 'counterclaim');
      const derivedStatus = supporting.length ? 'supported'
        : counterclaims.length ? 'counter_only' : '';
      const derivedKind = supporting.some(item => item.claimRelationKind === 'causal')
        ? 'causal' : 'correlative';
      if (!derivedStatus || relationStatus !== derivedStatus ||
          relation.renderable !== (derivedStatus === 'supported') ||
          relationKind !== derivedKind) return null;
      relationIds.add(relationId);
      relationIdentities.add(relationIdentity);
      relations.push({
        relationId, sourceNodeId, targetNodeId, relationKind, relationStatus,
        renderable: relation.renderable, polarity, context,
        assignments
      });
    }
    const relationIndex = new Map(relations.map(relation => [
      relation.relationId, relation
    ]));
    const normalizeIdList = (value, maximum, allowed, pattern) => {
      const rows = strictGeneratedArray(value, maximum);
      if (!rows) return null;
      const result = rows.map(item => strictGeneratedText(item, 160, pattern));
      if (result.some((item, index) => !item || !allowed.has(item) ||
          (index > 0 && result[index - 1] >= item))) return null;
      return result;
    };
    const nonGraphPlacement = new Map();
    let nonGraphEvidence;
    if (typeof source.nonGraphEvidence !== 'undefined') {
      const rows = strictGeneratedArray(source.nonGraphEvidence, 1024);
      if (!rows) return null;
      nonGraphEvidence = [];
      for (const raw of rows) {
        const item = ownRecord(raw, [
          'claimId', 'panelKey', 'sourceNodeId', 'targetNodeId', 'evidenceKind'
        ]);
        const claimId = strictGeneratedText(item.claimId, 160,
          /^claim-v1-[a-f0-9]{16}$/u);
        const claim = claimIndex.get(claimId);
        const panelKey = normalizeGeneratedPanelKey(item.panelKey);
        const sourceNodeId = strictGeneratedText(item.sourceNodeId, 160,
          nodeDialect.idPattern);
        const targetNodeId = strictGeneratedText(item.targetNodeId, 160,
          nodeDialect.idPattern);
        const evidenceKind = ['counterevidence', 'inconclusive', 'null_result']
          .includes(item.evidenceKind) ? item.evidenceKind : '';
        if (!claim || claim.panelKey !== panelKey || !sourceNodeId || !targetNodeId ||
            !nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId) || !evidenceKind ||
            nonGraphPlacement.has(claimId)) return null;
        nonGraphPlacement.set(claimId, { sourceNodeId, targetNodeId, evidenceKind });
        nonGraphEvidence.push({ claimId, panelKey, sourceNodeId, targetNodeId, evidenceKind });
      }
    }
    const nodePlacement = new Map();
    let nodeEvidence;
    if (typeof source.nodeEvidence !== 'undefined') {
      const rows = strictGeneratedArray(source.nodeEvidence, 1024);
      if (!rows) return null;
      nodeEvidence = [];
      for (const raw of rows) {
        const item = ownRecord(raw, ['claimId', 'panelKey', 'nodeIds', 'evidenceKind']);
        const claimId = strictGeneratedText(item.claimId, 160,
          /^claim-v1-[a-f0-9]{16}$/u);
        const claim = claimIndex.get(claimId);
        const panelKey = normalizeGeneratedPanelKey(item.panelKey);
        const itemNodeIds = normalizeIdList(
          item.nodeIds, 64, nodeIds, nodeDialect.idPattern
        );
        const evidenceKind = ['localization', 'node_observation']
          .includes(item.evidenceKind) ? item.evidenceKind : '';
        if (!claim || claim.panelKey !== panelKey || !itemNodeIds?.length ||
            !evidenceKind || nodePlacement.has(claimId) ||
            nonGraphPlacement.has(claimId)) return null;
        nodePlacement.set(claimId, {
          sourceNodeId: itemNodeIds[0], targetNodeId: itemNodeIds[0], evidenceKind
        });
        nodeEvidence.push({ claimId, panelKey, nodeIds: itemNodeIds, evidenceKind });
      }
    }
    let claimUsages;
    if (typeof source.claimUsages !== 'undefined') {
      const usageRows = strictGeneratedArray(source.claimUsages, 1024);
      if (!usageRows) return null;
      const seenUsageClaims = new Set();
      claimUsages = [];
      for (const raw of usageRows) {
        const usage = ownRecord(raw, [
          'claimId', 'panelKey', 'usageKind', 'relationIds', 'nodeIds',
          'evidenceClass', 'color'
        ]);
        const matrix = strictOwnDataRecord(raw, [], [
          'matrixSourceNodeId', 'matrixTargetNodeId'
        ]);
        if (!matrix) return null;
        const claimId = strictGeneratedText(usage.claimId, 160,
          /^claim-v1-[a-f0-9]{16}$/u);
        const claim = claimIndex.get(claimId);
        const panelKey = normalizeGeneratedPanelKey(usage.panelKey);
        const usageKind = [
          'relation', 'counterclaim', 'counterevidence', 'inconclusive',
          'null_result', 'localization', 'node_observation'
        ].includes(usage.usageKind) ? usage.usageKind : '';
        const usageRelationIds = normalizeIdList(
          usage.relationIds, 64, relationIds, /^relation-v1-[a-f0-9]{16}$/u
        );
        const usageNodeIds = normalizeIdList(
          usage.nodeIds, 64, nodeIds, nodeDialect.idPattern
        );
        const evidenceClass = ['sufficiency', 'necessity', 'other']
          .includes(usage.evidenceClass) ? usage.evidenceClass : '';
        const color = ['red', 'blue', 'black', 'purple', 'amber']
          .includes(usage.color) ? usage.color : '';
        if (!claim || claim.panelKey !== panelKey || !usageKind ||
            !usageRelationIds || !usageNodeIds?.length || !evidenceClass || !color ||
            seenUsageClaims.has(claimId)) return null;
        let placement = nonGraphPlacement.get(claimId) || nodePlacement.get(claimId);
        if (placement && placement.evidenceKind !== usageKind) return null;
        if (usageRelationIds.length) {
          // Atomic claims have one placement. Do not silently prioritize a
          // relation over conflicting node/non-graph evidence during restore.
          if (placement) return null;
          const targets = usageRelationIds.map(id => relationIndex.get(id));
          const first = targets[0];
          if (!first || targets.some(relation =>
            relation.sourceNodeId !== first.sourceNodeId ||
            relation.targetNodeId !== first.targetNodeId)) return null;
          placement = {
            sourceNodeId: first.sourceNodeId,
            targetNodeId: first.targetNodeId,
            evidenceKind: usageKind
          };
        }
        // Older saved previews contain the validated matrix pair but omit the
        // placement records. Preserve that direction instead of inferring it
        // from lexicographically sorted node IDs during archive restoration.
        const hasMatrix = Object.hasOwn(matrix, 'matrixSourceNodeId') ||
          Object.hasOwn(matrix, 'matrixTargetNodeId');
        if (hasMatrix) {
          const sourceNodeId = strictGeneratedText(matrix.matrixSourceNodeId, 160,
            nodeDialect.idPattern);
          const targetNodeId = strictGeneratedText(matrix.matrixTargetNodeId, 160,
            nodeDialect.idPattern);
          if (!sourceNodeId || !targetNodeId ||
              !usageNodeIds.includes(sourceNodeId) ||
              !usageNodeIds.includes(targetNodeId) ||
              (placement && (placement.sourceNodeId !== sourceNodeId ||
                placement.targetNodeId !== targetNodeId))) return null;
          if (['localization', 'node_observation'].includes(usageKind) &&
              (sourceNodeId !== usageNodeIds[0] || targetNodeId !== sourceNodeId)) return null;
          placement ||= { sourceNodeId, targetNodeId, evidenceKind: usageKind };
        }
        if (!placement) {
          placement = usageNodeIds.length === 1 ||
              ['localization', 'node_observation'].includes(usageKind)
            ? {
                sourceNodeId: usageNodeIds[0], targetNodeId: usageNodeIds[0],
                evidenceKind: usageKind
              }
            : {
                sourceNodeId: usageNodeIds[0], targetNodeId: usageNodeIds[1],
                evidenceKind: usageKind
              };
        }
        if (!usageNodeIds.includes(placement.sourceNodeId) ||
            !usageNodeIds.includes(placement.targetNodeId)) return null;
        seenUsageClaims.add(claimId);
        claimUsages.push({
          claimId, panelKey, usageKind, relationIds: usageRelationIds,
          nodeIds: usageNodeIds, evidenceClass, color,
          matrixSourceNodeId: placement.sourceNodeId,
          matrixTargetNodeId: placement.targetNodeId
        });
      }
    }
    let unresolvedClaims;
    if (typeof source.unresolvedClaims !== 'undefined') {
      const unresolvedRows = strictGeneratedArray(source.unresolvedClaims, 1024);
      if (!unresolvedRows) return null;
      const seen = new Set();
      unresolvedClaims = [];
      for (const raw of unresolvedRows) {
        const item = ownRecord(raw, ['claimId', 'panelKey', 'reason']);
        const claimId = strictGeneratedText(item.claimId, 160,
          /^claim-v1-[a-f0-9]{16}$/u);
        const claim = claimIndex.get(claimId);
        const panelKey = normalizeGeneratedPanelKey(item.panelKey);
        const reason = typeof item.reason === 'string' && /^[a-z_]{1,80}$/u.test(item.reason)
          ? item.reason : '';
        if (!claim || claim.panelKey !== panelKey || !reason || seen.has(claimId)) return null;
        seen.add(claimId);
        unresolvedClaims.push({ claimId, panelKey, reason });
      }
    }
    if (claimUsages || unresolvedClaims) {
      const covered = new Set([
        ...(claimUsages || []).map(item => item.claimId),
        ...(unresolvedClaims || []).map(item => item.claimId)
      ]);
      if (covered.size !== (claimUsages || []).length + (unresolvedClaims || []).length ||
          covered.size !== claims.length) return null;
    }
    let panelDispositions;
    if (typeof source.panelDispositions !== 'undefined') {
      const rows = strictGeneratedArray(source.panelDispositions, 512);
      if (!rows) return null;
      const panelKeys = new Set();
      panelDispositions = [];
      for (const raw of rows) {
        const item = ownRecord(raw, [
          'panelKey', 'status', 'relationIds', 'nodeIds', 'claimIds', 'reason'
        ]);
        const panelKey = normalizeGeneratedPanelKey(item.panelKey);
        const dispositionStatus = [
          'linked_causal', 'linked_correlative', 'node_evidence',
          'excluded_schematic', 'unresolved'
        ].includes(item.status) ? item.status : '';
        const itemRelationIds = normalizeIdList(
          item.relationIds, 64, relationIds, /^relation-v1-[a-f0-9]{16}$/u
        );
        const itemNodeIds = normalizeIdList(
          item.nodeIds, 64, nodeIds, nodeDialect.idPattern
        );
        const itemClaimIds = normalizeIdList(
          item.claimIds, 1024, new Set(claimIndex.keys()), /^claim-v1-[a-f0-9]{16}$/u
        );
        const reason = typeof item.reason === 'string' &&
          (item.reason === '' || /^[a-z_]{1,80}$/u.test(item.reason)) ? item.reason : null;
        if (!panelKey || !dispositionStatus || !itemRelationIds || !itemNodeIds ||
            !itemClaimIds || reason === null || panelKeys.has(panelKey) ||
            itemClaimIds.some(id => claimIndex.get(id)?.panelKey !== panelKey)) return null;
        if (dispositionStatus === 'excluded_schematic' &&
            reason !== 'source_backed_schematic') return null;
        panelKeys.add(panelKey);
        panelDispositions.push({
          panelKey, status: dispositionStatus, relationIds: itemRelationIds,
          nodeIds: itemNodeIds, claimIds: itemClaimIds, reason
        });
      }
    }
    return {
      status, canonicalDigest, nodes, relations, claims,
      ...(nodeEvidence ? { nodeEvidence } : {}),
      ...(nonGraphEvidence ? { nonGraphEvidence } : {}),
      ...(claimUsages ? { claimUsages } : {}),
      ...(unresolvedClaims ? { unresolvedClaims } : {}),
      ...(panelDispositions ? { panelDispositions } : {})
    };
  }

  function normalizeGeneratedMechanismIdentity(value) {
    const source = ownRecord(value, [
      'operationId', 'operationEpoch', 'documentId', 'workspaceId',
      'workspaceGeneration', 'workspaceLifecycle', 'baseWorkspaceRevision',
      'mechanismChainFingerprint'
    ]);
    const identity = {
      operationId: strictGeneratedText(source.operationId, 100,
        /^mechanism:[A-Za-z0-9:._-]{8,90}$/u),
      operationEpoch: source.operationEpoch,
      documentId: strictGeneratedText(source.documentId, 1000),
      workspaceId: strictGeneratedText(source.workspaceId, 1000),
      workspaceGeneration: source.workspaceGeneration,
      workspaceLifecycle: source.workspaceLifecycle,
      baseWorkspaceRevision: source.baseWorkspaceRevision,
      mechanismChainFingerprint: strictGeneratedText(
        source.mechanismChainFingerprint, 100,
        /^mechanism-chain-v1-[a-f0-9]{8,64}$/u
      )
    };
    if (!identity.operationId || !Number.isSafeInteger(identity.operationEpoch) ||
        identity.operationEpoch < 1 || !identity.documentId || !identity.workspaceId ||
        !Number.isSafeInteger(identity.workspaceGeneration) ||
        identity.workspaceGeneration < 1 ||
        !Number.isSafeInteger(identity.workspaceLifecycle) ||
        identity.workspaceLifecycle < 0 ||
        !Number.isSafeInteger(identity.baseWorkspaceRevision) ||
        identity.baseWorkspaceRevision < 0 || !identity.mechanismChainFingerprint) return null;
    return identity;
  }

  function normalizeMechanismGenerationSnapshot(value) {
    const source = ownRecord(value, [
      'status', 'evidenceFirstVersions', 'identity', 'committedWorkspaceRevision',
      'preview', 'updatedAt'
    ]);
    if (source.status !== 'complete') return null;
    const evidenceFirstVersions = normalizeEvidenceFirstVersions(
      source.evidenceFirstVersions
    );
    const identity = normalizeGeneratedMechanismIdentity(source.identity);
    const preview = normalizeGeneratedMechanismPreview(source.preview);
    const committedWorkspaceRevision = source.committedWorkspaceRevision;
    if (!evidenceFirstVersions || !identity || !preview || preview.status !== 'complete' ||
        !Number.isSafeInteger(committedWorkspaceRevision) ||
        committedWorkspaceRevision < 1 ||
        identity.baseWorkspaceRevision >= MAX_REVISION ||
        committedWorkspaceRevision !== identity.baseWorkspaceRevision + 1) return null;
    return {
      status: 'complete', evidenceFirstVersions, identity, committedWorkspaceRevision, preview,
      updatedAt: boundedTimestamp(source.updatedAt)
    };
  }

  function generationEnvelopeDigest(value) {
    const text = String(value);
    const states = [
      0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
      0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5
    ];
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      for (let lane = 0; lane < states.length; lane += 1) {
        states[lane] ^= code + Math.imul(index + 1, lane + 17);
        states[lane] = Math.imul(states[lane], 0x01000193) >>> 0;
        states[lane] ^= states[lane] >>> 13;
      }
    }
    return `mechanism-envelope-v1-${states.map(value =>
      value.toString(16).padStart(8, '0')).join('')}`;
  }

  function deepFreezeGenerationSnapshot(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const item of Object.values(value)) deepFreezeGenerationSnapshot(item, seen);
    return Object.freeze(value);
  }

  function brandGenerationSnapshot(value) {
    deepFreezeGenerationSnapshot(value);
    TRUSTED_GENERATION_SNAPSHOTS.add(value);
    return value;
  }

  function generationProjectionPayload(evidenceFirstVersions, identity, preview) {
    return { status: 'complete', evidenceFirstVersions, identity, preview };
  }

  function durableGenerationProjectionPayload(snapshot) {
    return {
      status: 'complete', evidenceFirstVersions: snapshot.evidenceFirstVersions,
      identity: snapshot.identity,
      committedWorkspaceRevision: snapshot.committedWorkspaceRevision,
      preview: snapshot.preview, updatedAt: snapshot.updatedAt
    };
  }

  function generatedChainProjection(preview) {
    return {
      nodes: preview.nodes.map(node => ({ nodeId: node.nodeId, label: node.label })),
      relations: preview.relations.filter(relation => relation.renderable === true)
        .map(relation => ({
          relationId: relation.relationId,
          sourceNodeId: relation.sourceNodeId,
          targetNodeId: relation.targetNodeId,
          polarity: relation.polarity,
          panelEvidence: generatedRelationPanelEvidence(relation)
        }))
    };
  }

  function parseGenerationEnvelopeJson(value) {
    if (typeof value !== 'string' || !value ||
        value.length > MAX_MECHANISM_GENERATION_ENVELOPE_LENGTH) return null;
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function normalizeGenerationCandidateEnvelopeObject(value) {
    const source = ownRecord(value, [
      'schemaVersion', 'envelopeKind', 'status', 'evidenceFirstVersions',
      'identity', 'preview',
      'projectionDigest'
    ]);
    if (source.schemaVersion !== MECHANISM_GENERATION_ENVELOPE_VERSION ||
        source.envelopeKind !== 'candidate' || source.status !== 'complete') return null;
    const evidenceFirstVersions = normalizeEvidenceFirstVersions(
      source.evidenceFirstVersions
    );
    const identity = normalizeGeneratedMechanismIdentity(source.identity);
    const preview = normalizeGeneratedMechanismPreview(source.preview, 'node-v2');
    if (!evidenceFirstVersions || !identity || !preview || preview.status !== 'complete') return null;
    const projectionDigest = generationEnvelopeDigest(JSON.stringify(
      generationProjectionPayload(evidenceFirstVersions, identity, preview)
    ));
    if (source.projectionDigest !== projectionDigest) return null;
    return {
      schemaVersion: MECHANISM_GENERATION_ENVELOPE_VERSION,
      envelopeKind: 'candidate', status: 'complete', evidenceFirstVersions,
      identity, preview,
      projectionDigest
    };
  }

  function parseGenerationCandidateEnvelope(value) {
    const parsed = parseGenerationEnvelopeJson(value);
    const normalized = parsed && normalizeGenerationCandidateEnvelopeObject(parsed);
    if (!normalized || JSON.stringify(normalized) !== value) return null;
    return brandGenerationSnapshot(normalized);
  }

  function createMechanismGenerationCandidateEnvelope(value) {
    const parsed = parseGenerationEnvelopeJson(value);
    if (!parsed) return '';
    const generation = ownRecord(parsed, [
      'status', 'operationId', 'operationEpoch', 'documentId', 'workspaceId',
      'workspaceGeneration', 'workspaceLifecycle', 'baseWorkspaceRevision',
      'mechanismChainFingerprint', 'evidenceFirstVersions', 'evidenceFirstMechanism'
    ]);
    if (generation.status !== 'complete') return '';
    const evidenceFirstVersions = normalizeEvidenceFirstVersions(
      generation.evidenceFirstVersions
    );
    const identity = normalizeGeneratedMechanismIdentity(generation);
    const preview = normalizeGeneratedMechanismPreview(
      generation.evidenceFirstMechanism, 'node-v2'
    );
    if (!evidenceFirstVersions || !identity || !preview || preview.status !== 'complete') return '';
    const projectionDigest = generationEnvelopeDigest(JSON.stringify(
      generationProjectionPayload(evidenceFirstVersions, identity, preview)
    ));
    const envelope = JSON.stringify({
      schemaVersion: MECHANISM_GENERATION_ENVELOPE_VERSION,
      envelopeKind: 'candidate', status: 'complete', evidenceFirstVersions,
      identity, preview,
      projectionDigest
    });
    return envelope.length <= MAX_MECHANISM_GENERATION_ENVELOPE_LENGTH ? envelope : '';
  }

  function normalizeMechanismGeneration(value) {
    const parsed = parseGenerationEnvelopeJson(value);
    if (!parsed) return null;
    const source = ownRecord(parsed, [
      'schemaVersion', 'envelopeKind', 'status', 'evidenceFirstVersions', 'identity',
      'committedWorkspaceRevision', 'preview', 'updatedAt',
      'projectionDigest', 'chainProjectionDigest'
    ]);
    if (source.schemaVersion !== MECHANISM_GENERATION_ENVELOPE_VERSION ||
        source.envelopeKind !== 'durable') return null;
    const normalized = normalizeMechanismGenerationSnapshot(source);
    if (!normalized) return null;
    const projectionDigest = generationEnvelopeDigest(JSON.stringify(
      durableGenerationProjectionPayload(normalized)
    ));
    const chainProjectionDigest = generationEnvelopeDigest(JSON.stringify(
      generatedChainProjection(normalized.preview)
    ));
    if (source.projectionDigest !== projectionDigest ||
        source.chainProjectionDigest !== chainProjectionDigest) return null;
    const envelope = {
      schemaVersion: MECHANISM_GENERATION_ENVELOPE_VERSION,
      envelopeKind: 'durable', status: 'complete',
      evidenceFirstVersions: normalized.evidenceFirstVersions,
      identity: normalized.identity,
      committedWorkspaceRevision: normalized.committedWorkspaceRevision,
      preview: normalized.preview, updatedAt: normalized.updatedAt,
      projectionDigest, chainProjectionDigest
    };
    if (JSON.stringify(envelope) !== value) return null;
    return brandGenerationSnapshot(envelope);
  }

  function serializeDurableGenerationEnvelope(candidate, committedWorkspaceRevision, now) {
    if (!TRUSTED_GENERATION_SNAPSHOTS.has(candidate) ||
        candidate.envelopeKind !== 'candidate') return '';
    const snapshot = normalizeMechanismGenerationSnapshot({
      status: 'complete', evidenceFirstVersions: candidate.evidenceFirstVersions,
      identity: candidate.identity,
      committedWorkspaceRevision, preview: candidate.preview,
      updatedAt: boundedTimestamp(now)
    });
    if (!snapshot) return '';
    const envelope = {
      schemaVersion: MECHANISM_GENERATION_ENVELOPE_VERSION,
      envelopeKind: 'durable', status: 'complete',
      evidenceFirstVersions: snapshot.evidenceFirstVersions,
      identity: snapshot.identity,
      committedWorkspaceRevision: snapshot.committedWorkspaceRevision,
      preview: snapshot.preview, updatedAt: snapshot.updatedAt,
      projectionDigest: generationEnvelopeDigest(JSON.stringify(
        durableGenerationProjectionPayload(snapshot)
      )),
      chainProjectionDigest: generationEnvelopeDigest(JSON.stringify(
        generatedChainProjection(snapshot.preview)
      ))
    };
    const serialized = JSON.stringify(envelope);
    return serialized.length <= MAX_MECHANISM_GENERATION_ENVELOPE_LENGTH
      ? serialized : '';
  }

  function readMechanismGenerationEnvelope(value) {
    const snapshot = normalizeMechanismGeneration(value) ||
      parseGenerationCandidateEnvelope(value);
    if (!snapshot) return null;
    return deepFreezeGenerationSnapshot(cloneNormalizedWorkspaceValue(snapshot));
  }

  function generatedAuditEvidenceCode(claim, role = 'supporting') {
    if (role === 'counterclaim' || claim?.outcome === 'refutes') return 'C';
    if (claim?.outcome === 'mixed' || claim?.outcome === 'inconclusive' ||
        claim?.effectSign === 'mixed') return '?';
    if (claim?.effectSign === 'no_change') return '0';
    if (claim?.semantics === 'descriptive') return 'O';
    if (claim?.semantics === 'associational') return 'A';
    return ({
      sufficiency: 'S', necessity: 'N', rescue: 'R', epistasis: 'E',
      directional_intervention: 'I'
    })[claim?.causalTest] || '?';
  }

  function generatedAuditComponents(nodes, relations) {
    const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
    const byNode = new Map();
    relations.filter(relation => relation.renderable).forEach(relation => {
      for (const nodeId of [relation.from, relation.to]) {
        if (!byNode.has(nodeId)) byNode.set(nodeId, []);
        byNode.get(nodeId).push(relation);
      }
    });
    const visited = new Set();
    const components = [];
    for (const start of nodes.map(node => node.id)) {
      if (!byNode.has(start) || visited.has(start)) continue;
      const queue = [start];
      const nodeIds = [];
      const relationIds = new Set();
      while (queue.length) {
        const nodeId = queue.shift();
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        nodeIds.push(nodeId);
        for (const relation of byNode.get(nodeId) || []) {
          relationIds.add(relation.id);
          const next = relation.from === nodeId ? relation.to : relation.from;
          if (!visited.has(next)) queue.push(next);
        }
      }
      nodeIds.sort((left, right) => nodeOrder.get(left) - nodeOrder.get(right));
      components.push({
        componentId: `component-${components.length + 1}`,
        nodeIds,
        relationIds: [...relationIds].sort()
      });
    }
    return components;
  }

  // Task 9 deliberately accepts only Task 8's primitive canonical envelope.
  // Arbitrary audit objects never enter this reader and cannot acquire trust by
  // resembling the normalized presentation shape.
  function readMechanismGenerationAudit(value) {
    if (typeof value !== 'string') return null;
    const envelope = readMechanismGenerationEnvelope(value);
    const preview = envelope?.preview;
    if (!preview || preview.status !== 'complete') return null;
    const claimsById = new Map(preview.claims.map(claim => [claim.claimId, claim]));
    const nodes = preview.nodes.map(node => ({
      id: node.nodeId, label: node.label, nodeType: node.nodeType
    }));
    const relations = preview.relations.map(relation => {
      const evidence = relation.assignments.map(assignment => ({
        claimId: assignment.claimId,
        panelKey: assignment.panelKey,
        code: generatedAuditEvidenceCode(
          claimsById.get(assignment.claimId), assignment.role
        ),
        role: assignment.role
      }));
      const supporting = evidence.some(item => item.role === 'supporting');
      const counter = evidence.some(item => item.role === 'counterclaim');
      return {
        id: relation.relationId,
        from: relation.sourceNodeId,
        to: relation.targetNodeId,
        relationKind: relation.relationKind,
        renderable: relation.renderable === true && supporting,
        lineStyle: relation.relationKind === 'correlative' ? 'dashed' : 'solid',
        contested: supporting && counter,
        polarity: relation.polarity,
        evidence
      };
    });
    const relationById = new Map(relations.map(relation => [relation.id, relation]));
    const explicitUsages = Array.isArray(preview.claimUsages)
      ? preview.claimUsages : [];
    const syntheticUsages = new Map();
    if (!explicitUsages.length) {
      for (const relation of relations) {
        for (const item of relation.evidence) {
          const prior = syntheticUsages.get(item.claimId);
          if (prior && (prior.matrixSourceNodeId !== relation.from ||
              prior.matrixTargetNodeId !== relation.to)) return null;
          const usage = prior || {
            claimId: item.claimId, panelKey: item.panelKey,
            usageKind: item.role === 'counterclaim' ? 'counterclaim' : 'relation',
            relationIds: [], nodeIds: [relation.from, relation.to].sort(),
            matrixSourceNodeId: relation.from, matrixTargetNodeId: relation.to
          };
          if (!usage.relationIds.includes(relation.id)) usage.relationIds.push(relation.id);
          syntheticUsages.set(item.claimId, usage);
        }
      }
    }
    const usages = explicitUsages.length ? explicitUsages : [...syntheticUsages.values()];
    const usageByClaim = new Map(usages.map(usage => [usage.claimId, usage]));
    const unresolvedByClaim = new Map((preview.unresolvedClaims || []).map(item => [
      item.claimId, item
    ]));
    const placements = [];
    const unresolvedEvidence = [];
    for (const claim of preview.claims) {
      const usage = usageByClaim.get(claim.claimId);
      if (!usage) {
        unresolvedEvidence.push({
          claimId: claim.claimId, panelKey: claim.panelKey,
          code: generatedAuditEvidenceCode(claim),
          reason: unresolvedByClaim.get(claim.claimId)?.reason || 'missing_audit_placement'
        });
        continue;
      }
      const relationRoles = usage.relationIds.flatMap(id =>
        (relationById.get(id)?.evidence || []).filter(item =>
          item.claimId === claim.claimId).map(item => item.role)
      );
      const role = relationRoles.includes('counterclaim') ? 'counterclaim'
        : usage.usageKind === 'counterevidence' ? 'counterclaim'
          : usage.relationIds.length ? 'supporting' : 'audit';
      placements.push({
        claimId: claim.claimId,
        panelKey: claim.panelKey,
        from: usage.matrixSourceNodeId,
        to: usage.matrixTargetNodeId,
        code: generatedAuditEvidenceCode(claim, role),
        role,
        relationIds: usage.relationIds.slice()
      });
    }
    const components = generatedAuditComponents(nodes, relations);
    const connectedNodeIds = new Set(components.flatMap(component => component.nodeIds));
    const disconnectedByNode = new Map();
    for (const placement of placements) {
      for (const nodeId of new Set([placement.from, placement.to])) {
        if (connectedNodeIds.has(nodeId)) continue;
        if (!disconnectedByNode.has(nodeId)) {
          const node = nodes.find(item => item.id === nodeId);
          if (!node) return null;
          disconnectedByNode.set(nodeId, {
            nodeId, label: node.label, codes: new Set(), claimIds: new Set()
          });
        }
        const item = disconnectedByNode.get(nodeId);
        item.codes.add(placement.code);
        item.claimIds.add(placement.claimId);
      }
    }
    const disconnectedEvidence = nodes.filter(node => disconnectedByNode.has(node.id))
      .map(node => {
        const item = disconnectedByNode.get(node.id);
        return {
          nodeId: node.id,
          label: node.label,
          codes: [...item.codes],
          claimCount: item.claimIds.size
        };
      });
    const exclusions = (preview.panelDispositions || [])
      .filter(item => item.status === 'excluded_schematic')
      .map(item => ({ panelKey: item.panelKey, reason: 'source_backed_schematic' }));
    return deepFreezeGenerationSnapshot({
      version: 'mechanism-audit-view-v1',
      status: preview.status,
      canonicalDigest: preview.canonicalDigest,
      nodes,
      relations,
      placements,
      components,
      disconnectedEvidence,
      exclusions,
      unresolvedEvidence
    });
  }

  function generatedRelationPanelEvidence(relation) {
    const evidenceByPanel = new Map();
    for (const assignment of relation.assignments) {
      const separator = assignment.panelKey.indexOf(':');
      const figureId = assignment.panelKey.slice(0, separator);
      const panelId = assignment.panelKey.slice(separator + 1);
      const evidenceClass = assignment.role === 'counterclaim'
        ? 'other' : assignment.evidenceClass;
      const key = `${figureId}\u0000${panelId}`;
      const prior = evidenceByPanel.get(key);
      if (!prior || (prior.evidenceClass === 'other' && evidenceClass !== 'other')) {
        evidenceByPanel.set(key, {
          figureId, panelId, evidenceClass, evidenceClassSource: 'inferred'
        });
      }
    }
    return [...evidenceByPanel.values()];
  }

  function exactGeneratedPanelEvidence(rawRows, expected) {
    const rows = strictGeneratedArray(rawRows, MAX_PANEL_IDS_PER_BLOCK);
    if (!rows || rows.length !== expected.length) return false;
    return rows.every((raw, index) => {
      const evidence = ownRecord(raw, [
        'figureId', 'panelId', 'evidenceClass', 'evidenceClassSource'
      ]);
      const target = expected[index];
      return evidence.figureId === target.figureId &&
        evidence.panelId === target.panelId &&
        evidence.evidenceClass === target.evidenceClass &&
        evidence.evidenceClassSource === 'inferred';
    });
  }

  function validateGeneratedMechanismChain(value, preview) {
    const source = ownRecord(value, ['nodes', 'edges']);
    const nodeRows = strictGeneratedArray(source.nodes, MAX_COLLECTION_ITEMS);
    const edgeRows = strictGeneratedArray(source.edges, MAX_COLLECTION_ITEMS);
    if (!nodeRows?.length || !edgeRows?.length) return false;
    const previewNodes = new Map(preview.nodes.map(node => [node.nodeId, node]));
    const nodes = new Set();
    for (const raw of nodeRows) {
      const node = ownRecord(raw, ['id', 'label']);
      const id = strictGeneratedText(node.id, 80,
        /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
      const label = strictGeneratedText(node.label, 240);
      if (!id || !label || nodes.has(id) || previewNodes.get(id)?.label !== label) {
        return false;
      }
      nodes.add(id);
    }
    if (nodes.size !== previewNodes.size) return false;
    const expectedRelations = new Map(preview.relations
      .filter(relation => relation.relationStatus === 'supported')
      .map(relation => [relation.relationId, relation]));
    if (!expectedRelations.size || edgeRows.length !== expectedRelations.size) return false;
    const edges = new Set();
    for (const raw of edgeRows) {
      const edge = ownRecord(raw, [
        'id', 'from', 'to', 'label', 'polarity', 'panelEvidence'
      ]);
      const id = strictGeneratedText(edge.id, 80,
        /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
      const from = strictGeneratedText(edge.from, 80,
        /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
      const to = strictGeneratedText(edge.to, 80,
        /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
      const relation = expectedRelations.get(id);
      const expectedPolarity = relation?.polarity === 'increases' ? 'positive'
        : relation?.polarity === 'decreases' ? 'negative' : 'neutral';
      const expectedEvidence = relation
        ? generatedRelationPanelEvidence(relation) : [];
      if (!id || !from || !to || !nodes.has(from) || !nodes.has(to) ||
          edges.has(id) || !relation || relation.sourceNodeId !== from ||
          relation.targetNodeId !== to || edge.label !== '' ||
          edge.polarity !== expectedPolarity ||
          !exactGeneratedPanelEvidence(edge.panelEvidence, expectedEvidence)) return false;
      edges.add(id);
    }
    return edges.size === expectedRelations.size;
  }

  function normalizedChainMatchesGeneration(chain, preview) {
    const previewNodes = new Map(preview.nodes.map(node => [node.nodeId, node]));
    const seenNodes = new Set();
    for (const node of chain.nodes) {
      const previewNode = previewNodes.get(node.id);
      if (!previewNode) {
        if (node.label?.humanReviewed !== true) return false;
        continue;
      }
      if (seenNodes.has(node.id) || node.label?.value !== previewNode.label) return false;
      seenNodes.add(node.id);
    }
    if (seenNodes.size !== previewNodes.size) return false;
    const previewRelations = new Map(preview.relations.map(relation => [
      relation.relationId, relation
    ]));
    const seenEdges = new Set();
    for (const edge of chain.edges) {
      const relation = previewRelations.get(edge.id);
      if (!relation) {
        const reviewedExtra = edge.humanReviewed === true ||
          edge.label?.humanReviewed === true ||
          edge.panelEvidence?.some(item => item.humanReviewed === true ||
            item.evidenceClassSource === 'manual');
        if (!reviewedExtra) return false;
        continue;
      }
      if (relation.renderable !== true || seenEdges.has(edge.id)) return false;
      const expectedPolarity = relation.polarity === 'increases' ? 'positive'
        : relation.polarity === 'decreases' ? 'negative' : 'neutral';
      if (!edge || edge.from !== relation.sourceNodeId ||
          edge.to !== relation.targetNodeId || edge.polarity !== expectedPolarity ||
          (edge.label?.value !== '' && edge.label?.humanReviewed !== true) ||
          !exactGeneratedPanelEvidence(
            edge.panelEvidence, generatedRelationPanelEvidence(relation)
          )) return false;
      seenEdges.add(edge.id);
    }
    return seenEdges.size === [...previewRelations.values()]
      .filter(relation => relation.renderable === true).length;
  }

  function generatedAuditMatchesDraft(generation, binding, revision) {
    const identity = generation?.identity;
    return Boolean(binding && identity &&
      identity.documentId === binding.documentId &&
      identity.workspaceId === binding.workspaceId &&
      identity.workspaceGeneration === binding.workspaceGeneration &&
      generation.committedWorkspaceRevision <= revision);
  }

  function parseGeneratedSourceHandle(value) {
    if (typeof value !== 'string' || value.length > 160) return null;
    const separator = value.lastIndexOf(':');
    if (separator < 1) return null;
    const panelKey = value.slice(0, separator);
    const field = value.slice(separator + 1);
    if (normalizeGeneratedPanelKey(panelKey) !== panelKey ||
        !GENERATED_SOURCE_FIELDS.has(field)) return null;
    return { panelKey, field };
  }

  function generatedAuditReferencesPanelField(generationEnvelope, figureId, panelId, field) {
    if (!generationEnvelope || !GENERATED_SOURCE_FIELDS.has(field)) return false;
    const generation = normalizeMechanismGeneration(generationEnvelope);
    if (!generation) return true;
    const panelKey = normalizeGeneratedPanelKey(`${figureId}:${panelId}`);
    const preview = generation.preview;
    if (!panelKey || !preview || !Array.isArray(preview.claims) ||
        !Array.isArray(preview.relations)) return true;
    const sourceRefRows = [];
    for (const claim of preview.claims) sourceRefRows.push(claim.sourceRefs);
    for (const relation of preview.relations) {
      if (!Array.isArray(relation.assignments)) return true;
      for (const assignment of relation.assignments) {
        sourceRefRows.push(assignment.sourceRefs);
      }
    }
    for (const sourceRefs of sourceRefRows) {
      if (!Array.isArray(sourceRefs)) return true;
      for (const sourceRef of sourceRefs) {
        const parsed = parseGeneratedSourceHandle(sourceRef);
        if (!parsed) return true;
        if (parsed.panelKey === panelKey && parsed.field === field) return true;
      }
    }
    return false;
  }

  function editableListTextValues(value) {
    return Array.isArray(value) ? value.map(item => item.value) : [];
  }

  function sameTextValues(left, right) {
    return left.length === right.length &&
      left.every((item, index) => item === right[index]);
  }

  function normalizeFigureWorkspaceDraftValue(value, preserveGeneration = false) {
    const source = ownRecord(value, preserveGeneration
      ? ROOT_KEYS : ROOT_KEYS.filter(key => key !== 'mechanismGeneration'));
    const binding = normalizeFigureWorkspaceBinding(source.binding);
    const figures = createSafeMap();
    const entries = Array.isArray(source.figures)
      ? cappedArrayValues(source.figures, MAX_FIGURES).map(figure => {
        const record = ownRecord(figure, FIGURE_KEYS);
        return [record.figureId || record.id, figure];
      })
      : cappedMapEntries(source.figures, MAX_FIGURES);
    for (const [fallbackId, rawFigure] of entries) {
      const figure = normalizeFigure(rawFigure, fallbackId);
      if (!figure) continue;
      if (Object.hasOwn(figures, figure.figureId)) {
        figures[figure.figureId] = mergeFigureRecords(figures[figure.figureId], figure);
      } else {
        figures[figure.figureId] = figure;
      }
    }
    const revision = boundedRevision(source.revision);
    const normalizedGeneration = preserveGeneration
      ? normalizeMechanismGeneration(source.mechanismGeneration) : null;
    const rawAuditChain = normalizedGeneration
      ? strictGeneratedAuditChain(
          source.mechanismChain, normalizedGeneration.preview
        ) : null;
    const mechanismChain = normalizeMechanismChain(source.mechanismChain, figures);
    const mechanismGeneration = normalizedGeneration && rawAuditChain &&
      generatedAuditMatchesDraft(normalizedGeneration, binding, revision) &&
      normalizedChainMatchesGeneration(rawAuditChain, normalizedGeneration.preview)
      ? normalizedGeneration : null;
    const displayOrder = readFigureDisplayOrder(source.figureDisplayOrder);
    return {
      schemaVersion: FIGURE_WORKSPACE_DRAFT_VERSION,
      revision,
      ...(binding ? { binding } : {}),
      meta: normalizeMeta(source.meta),
      figures,
      evidenceBlocks: normalizeEvidenceBlocks(source.evidenceBlocks),
      supplementalPlacements: normalizeSupplementalPlacements(source.supplementalPlacements),
      ...(displayOrder ? { figureDisplayOrder: displayOrder.filter(id => Object.hasOwn(figures, id)) } : {}),
      mechanismChain,
      ...(mechanismGeneration ? { mechanismGeneration: source.mechanismGeneration } : {})
    };
  }

  function serializedDraftLength(draft) {
    return JSON.stringify(draft).length;
  }

  function figureWorkspaceAssetContentFingerprint(value) {
    const seen = new WeakSet();
    let remaining = FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS + 1;
    function stable(item, depth = 0) {
      if (depth > 16 || remaining < 0) throw workspaceError(
        'FIGURE_WORKSPACE_CONTENT_NONCANONICAL'
      );
      if (item === null || typeof item === 'boolean' || typeof item === 'number' ||
          typeof item === 'string') {
        if (typeof item === 'number' && !Number.isFinite(item)) {
          throw workspaceError('FIGURE_WORKSPACE_CONTENT_NONCANONICAL');
        }
        remaining -= typeof item === 'string' ? item.length + 2 : 16;
        return item;
      }
      if (!item || typeof item !== 'object' || seen.has(item)) {
        throw workspaceError('FIGURE_WORKSPACE_CONTENT_NONCANONICAL');
      }
      seen.add(item);
      if (Array.isArray(item)) {
        const output = item.map(entry => stable(entry, depth + 1));
        seen.delete(item);
        return output;
      }
      if (!isPlainObject(item)) {
        throw workspaceError('FIGURE_WORKSPACE_CONTENT_NONCANONICAL');
      }
      const output = {};
      for (const key of Object.keys(item).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          throw workspaceError('FIGURE_WORKSPACE_CONTENT_NONCANONICAL');
        }
        remaining -= key.length + 4;
        output[key] = stable(descriptor.value, depth + 1);
      }
      seen.delete(item);
      return output;
    }
    try {
      const text = JSON.stringify(stable(value));
      if (!text || text.length > FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS) return '';
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    } catch (_) {
      return '';
    }
  }

  function boundedContentFingerprint(value, canonicalShape = value) {
    const state = {
      // Canonical drafts serialize below 1M; a 2M comparison-work budget
      // leaves room for type/key accounting without trusting oversized input.
      remaining: (FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS * 2) + 2048,
      invalid: false,
      seen: new WeakSet()
    };
    function consume(length) {
      const amount = Math.max(1, Number(length) || 0);
      if (amount > state.remaining) {
        state.invalid = true;
        state.remaining = 0;
        return false;
      }
      state.remaining -= amount;
      return true;
    }
    function copy(item, expected, depth = 0) {
      if (state.invalid || depth > 16) {
        state.invalid = true;
        return null;
      }
      if (item === null || typeof item === 'boolean') {
        consume(5);
        return ['primitive', item];
      }
      if (typeof item === 'number') {
        consume(String(item).length + 2);
        return ['number', item];
      }
      if (typeof item === 'string') {
        if (!consume(item.length + 2)) return '';
        return ['string', item === expected ? 'same' : 'different', item.length,
          typeof expected === 'string' ? expected.length : -1];
      }
      if (typeof item !== 'object') {
        consume(16);
        return ['unsupported', typeof item];
      }
      if (state.seen.has(item)) {
        consume(8);
        return ['cycle'];
      }
      state.seen.add(item);
      if (!consume(2)) return null;
      let itemIsArray = false;
      try { itemIsArray = Array.isArray(item); } catch (_) {
        state.invalid = true;
        return null;
      }
      if (itemIsArray) {
        let length = 0;
        try {
          const descriptor = Object.getOwnPropertyDescriptor(item, 'length');
          length = descriptor && Number.isSafeInteger(descriptor.value) && descriptor.value >= 0
            ? descriptor.value : 0;
        } catch (_) {
          state.invalid = true;
          return null;
        }
        if (length > FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS) {
          state.invalid = true;
          return null;
        }
        let expectedIsArray = false;
        try { expectedIsArray = Array.isArray(expected); } catch (_) {}
        const expectedArray = expectedIsArray ? expected : [];
        const expectedKeys = new Set(Object.keys(expectedArray));
        let unknownKeys = 0;
        try {
          for (const key in item) {
            const descriptor = Object.getOwnPropertyDescriptor(item, key);
            if (!descriptor || descriptor.enumerable !== true) continue;
            if (!consume(key.length + 2)) break;
            if (!expectedKeys.has(key)) unknownKeys += 1;
          }
        } catch (_) {
          state.invalid = true;
          return null;
        }
        const entries = [];
        for (let index = 0; index < expectedArray.length && !state.invalid; index += 1) {
          let descriptor;
          try { descriptor = Object.getOwnPropertyDescriptor(item, String(index)); } catch (_) {
            state.invalid = true;
            break;
          }
          if (!descriptor || descriptor.enumerable !== true) {
            entries.push([index, ['missing']]);
          } else if (!Object.hasOwn(descriptor, 'value')) {
            entries.push([index, ['accessor']]);
          } else {
            entries.push([index, copy(descriptor.value, expectedArray[index], depth + 1)]);
          }
        }
        return ['array', length, ['unknown-own-keys', unknownKeys], entries];
      }
      let expectedIsArray = false;
      try { expectedIsArray = Array.isArray(expected); } catch (_) {}
      const expectedObject = expected && typeof expected === 'object' && !expectedIsArray
        ? expected : null;
      const expectedKeys = expectedObject ? Object.keys(expectedObject).sort() : [];
      const expectedKeySet = new Set(expectedKeys);
      let unknownKeys = 0;
      try {
        for (const key in item) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor || descriptor.enumerable !== true) continue;
          if (!consume(key.length + 4)) break;
          if (!expectedKeySet.has(key)) unknownKeys += 1;
        }
      } catch (_) {
        state.invalid = true;
      }
      const entries = [];
      for (const key of expectedKeys) {
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(item, key); } catch (_) {
          state.invalid = true;
          break;
        }
        if (!descriptor || descriptor.enumerable !== true) {
          entries.push([key, ['missing']]);
        } else if (!Object.hasOwn(descriptor, 'value')) {
          entries.push([key, ['accessor']]);
        } else {
          entries.push([key, copy(descriptor.value, expectedObject[key], depth + 1)]);
        }
        if (state.invalid) break;
      }
      return ['object', ['unknown-own-keys', unknownKeys], entries];
    }
    const copied = copy(value, canonicalShape);
    if (state.invalid) return 'FIGURE_WORKSPACE_CONTENT_NONCANONICAL';
    try { return JSON.stringify(copied); } catch (_) {
      return 'FIGURE_WORKSPACE_CONTENT_NONCANONICAL';
    }
  }

  function aggregateDraftTextCharacters(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 10) return 0;
    let total = 0;
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (typeof item === 'string') {
        // compactId is derived from already-counted Figure/Panel identifiers.
        if (key !== 'compactId') total += item.length;
      } else if (item && typeof item === 'object') {
        total += aggregateDraftTextCharacters(item, depth + 1);
      }
      if (total > FIGURE_WORKSPACE_TEXT_BUDGET) return total;
    }
    return total;
  }

  function editableStringReferences(value, references, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8) return;
    for (const key of Object.keys(value)) {
      if (key === 'value' && typeof value[key] === 'string' && value[key]) {
        references.push({ owner: value, key });
      } else if (value[key] && typeof value[key] === 'object') {
        editableStringReferences(value[key], references, depth + 1);
      }
    }
  }

  function cloneNormalizedWorkspaceValue(value, depth = 0) {
    if (depth > 12 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map(item => cloneNormalizedWorkspaceValue(item, depth + 1));
    }
    const clone = Object.getPrototypeOf(value) === null ? createSafeMap() : {};
    for (const key of Object.keys(value)) {
      clone[key] = cloneNormalizedWorkspaceValue(value[key], depth + 1);
    }
    return clone;
  }

  function draftExceedsWorkspaceBudget(draft) {
    return aggregateDraftTextCharacters(draft) > FIGURE_WORKSPACE_TEXT_BUDGET ||
      serializedDraftLength(draft) > FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS;
  }

  function workspaceValueMetrics(value) {
    return {
      serialized: JSON.stringify(value).length,
      text: aggregateDraftTextCharacters(value)
    };
  }

  function createWorkspaceBudgetTracker(draft, serializedReserve = 0) {
    let serialized = serializedDraftLength(draft) + Math.max(0, serializedReserve);
    let text = aggregateDraftTextCharacters(draft);
    return {
      tryDelta(serializedDelta, textDelta) {
        const nextSerialized = serialized + serializedDelta;
        const nextText = text + textDelta;
        if (nextSerialized > FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS ||
            nextText > FIGURE_WORKSPACE_TEXT_BUDGET) return false;
        serialized = nextSerialized;
        text = nextText;
        return true;
      },
      tryReplace(target, key, replacement) {
        const previousMetrics = workspaceValueMetrics(target[key]);
        const replacementMetrics = workspaceValueMetrics(replacement);
        if (!this.tryDelta(
          replacementMetrics.serialized - previousMetrics.serialized,
          replacementMetrics.text - previousMetrics.text
        )) return false;
        target[key] = replacement;
        return true;
      }
    };
  }

  function objectAdditionSerializedLength(key, valueMetrics, hasExistingEntries) {
    return JSON.stringify(key).length + 1 + valueMetrics.serialized +
      (hasExistingEntries ? 1 : 0);
  }

  function fitInventoryAdditions(draft, protectedDraft) {
    const fitted = cloneNormalizedWorkspaceValue(protectedDraft);
    const tracker = createWorkspaceBudgetTracker(fitted);
    for (const [figureId, candidateFigure] of cappedMapEntries(draft.figures, MAX_FIGURES)) {
      const protectedFigure = Object.hasOwn(protectedDraft.figures, figureId)
        ? protectedDraft.figures[figureId] : null;
      const previousFigure = Object.hasOwn(fitted.figures, figureId)
        ? fitted.figures[figureId] : null;
      const figure = cloneNormalizedWorkspaceValue(candidateFigure);
      const baselinePanels = createSafeMap();
      if (protectedFigure) {
        for (const [panelId, protectedPanel] of cappedMapEntries(
          protectedFigure.panels, MAX_PANELS_PER_FIGURE
        )) {
          baselinePanels[panelId] = cloneNormalizedWorkspaceValue(
            Object.hasOwn(candidateFigure.panels, panelId)
              ? candidateFigure.panels[panelId] : protectedPanel
          );
        }
      }
      figure.panels = baselinePanels;
      const figureMetrics = workspaceValueMetrics(figure);
      let figureSerializedDelta;
      let figureTextDelta;
      if (previousFigure) {
        const previousMetrics = workspaceValueMetrics(previousFigure);
        figureSerializedDelta = figureMetrics.serialized - previousMetrics.serialized;
        figureTextDelta = figureMetrics.text - previousMetrics.text;
      } else {
        figureSerializedDelta = objectAdditionSerializedLength(
          figureId, figureMetrics, Object.keys(fitted.figures).length > 0
        );
        figureTextDelta = figureMetrics.text;
      }
      if (!tracker.tryDelta(figureSerializedDelta, figureTextDelta)) continue;
      fitted.figures[figureId] = figure;

      const additions = cappedMapEntries(candidateFigure.panels, MAX_PANELS_PER_FIGURE)
        .filter(([panelId]) => !protectedFigure ||
          !Object.hasOwn(protectedFigure.panels, panelId));
      const additionMetrics = additions.map(([panelId, panel], index) => {
        const metrics = workspaceValueMetrics(panel);
        return {
          panelId,
          panel,
          serialized: objectAdditionSerializedLength(
            panelId, metrics, Object.keys(figure.panels).length + index > 0
          ),
          text: metrics.text
        };
      });
      const groupSerialized = additionMetrics.reduce((total, item) => total + item.serialized, 0);
      const groupText = additionMetrics.reduce((total, item) => total + item.text, 0);
      if (tracker.tryDelta(groupSerialized, groupText)) {
        for (const item of additionMetrics) {
          figure.panels[item.panelId] = cloneNormalizedWorkspaceValue(item.panel);
        }
        continue;
      }
      for (const item of additionMetrics) {
        if (!tracker.tryDelta(item.serialized, item.text)) break;
        figure.panels[item.panelId] = cloneNormalizedWorkspaceValue(item.panel);
      }
      return draftExceedsWorkspaceBudget(fitted)
        ? cloneNormalizedWorkspaceValue(protectedDraft) : fitted;
    }
    return draftExceedsWorkspaceBudget(fitted)
      ? cloneNormalizedWorkspaceValue(protectedDraft) : fitted;
  }

  function fitFigureWorkspaceDraftToBudget(draft, protectedDraft = null) {
    if (protectedDraft && !draftExceedsWorkspaceBudget(draft)) return draft;
    if (protectedDraft) {
      // Inventory is advisory. Build a bounded prefix on top of the exact
      // normalized base, trying whole Figures before a final Panel-by-Panel fit.
      // Existing identities and reviewed values are never candidates for trim.
      return fitInventoryAdditions(draft, protectedDraft);
    }
    let length = serializedDraftLength(draft);
    if (length <= FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS) return draft;
    const references = [];
    editableStringReferences(draft, references);
    let excess = length - FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS;
    for (let index = references.length - 1; index >= 0 && excess > 0; index -= 1) {
      const reference = references[index];
      const current = reference.owner[reference.key];
      const removed = Math.min(current.length, excess + 16);
      reference.owner[reference.key] = current.slice(0, current.length - removed);
      excess -= removed;
    }
    length = serializedDraftLength(draft);
    while (length > FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS) {
      const panels = [];
      for (const [, figure] of cappedMapEntries(draft.figures, MAX_FIGURES)) {
        for (const [panelId] of cappedMapEntries(figure.panels, MAX_PANELS_PER_FIGURE)) {
          panels.push({ figure, panelId });
        }
      }
      if (!panels.length) break;
      const removeCount = Math.min(panels.length, Math.max(
        1, Math.ceil((length - FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS) / 500)
      ));
      for (let index = 0; index < removeCount; index += 1) {
        const panel = panels[panels.length - 1 - index];
        delete panel.figure.panels[panel.panelId];
      }
      length = serializedDraftLength(draft);
    }
    if (length > FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS) {
      throw workspaceError('FIGURE_WORKSPACE_BUDGET_EXCEEDED');
    }
    return draft;
  }

  function withNormalizationBudget(work) {
    const owner = activeNormalizationTextBudget === null;
    if (owner) {
      activeNormalizationTextBudget = { remaining: FIGURE_WORKSPACE_TEXT_BUDGET };
    }
    try {
      return work();
    } finally {
      if (owner) activeNormalizationTextBudget = null;
    }
  }

  function normalizeFigureWorkspaceDraft(value) {
    return withNormalizationBudget(() => {
      const trustedInput = Boolean(value && typeof value === 'object' &&
        TRUSTED_FIGURE_WORKSPACE_DRAFTS.has(value));
      const normalized = fitFigureWorkspaceDraftToBudget(
        normalizeFigureWorkspaceDraftValue(value, trustedInput)
      );
      if (trustedInput) TRUSTED_FIGURE_WORKSPACE_DRAFTS.add(normalized);
      return normalized;
    });
  }

  function normalizeFigureWorkspaceDraftForImport(value) {
    return withNormalizationBudget(() => fitFigureWorkspaceDraftToBudget(
      normalizeFigureWorkspaceDraftValue(value, true)
    ));
  }

  function normalizeFigureWorkspaceDraftFromStorage(value) {
    return withNormalizationBudget(() => {
      const normalized = fitFigureWorkspaceDraftToBudget(
        normalizeFigureWorkspaceDraftValue(value, true)
      );
      TRUSTED_FIGURE_WORKSPACE_DRAFTS.add(normalized);
      return normalized;
    });
  }

  function ensureFigureDraft(draft, value) {
    const incoming = normalizeFigure(value);
    if (!incoming) return;
    const source = ownRecord(value, FIGURE_KEYS);
    const isModelResult = typeof source.analysisDepth === 'string';
    const existing = Object.hasOwn(draft.figures, incoming.figureId)
      ? draft.figures[incoming.figureId] : null;
    if (!existing && Object.keys(draft.figures).length >= MAX_FIGURES) return;
    const figure = existing ? mergeFigureRecords(existing, incoming) : incoming;
    const suppliedPanels = panelEntries(source.panelHints).concat(panelEntries(source.panels));
    for (const [rawId, rawPanel] of suppliedPanels) {
      const panel = ownRecord(rawPanel, PANEL_KEYS);
      const panelId = safePanelId(isPlainObject(rawPanel)
        ? panel.panelId || panel.panel || rawId : rawId);
      if (!panelId) continue;
      const normalized = normalizePanel(
        rawPanel, panelId, figure.figureLabel, !isModelResult, figure.isSupplemental
      );
      if (Object.hasOwn(figure.panels, panelId)) {
        figure.panels[panelId] = mergePanelRecords(
          figure.panels[panelId], normalized, figure.figureLabel, figure.isSupplemental
        );
      } else if (Object.keys(figure.panels).length < MAX_PANELS_PER_FIGURE) {
        figure.panels[panelId] = emptyPanel(
          panelId, figure.figureLabel, figure.isSupplemental
        );
      }
    }
    for (const [, panel] of cappedMapEntries(figure.panels, MAX_PANELS_PER_FIGURE)) {
      panel.compactId = figurePanelDisplayId(
        figure.figureLabel, figure.isSupplemental, panel.panelId
      );
    }
    draft.figures[incoming.figureId] = figure;
  }

  function createFigureWorkspaceDraft(figures, previous = null) {
    return withNormalizationBudget(() => {
      const preserveCapability = previous === null || previous === undefined ||
        (typeof previous === 'object' &&
          TRUSTED_FIGURE_WORKSPACE_DRAFTS.has(previous));
      const protectedDraft = normalizeFigureWorkspaceDraft(previous);
      const normalized = cloneNormalizedWorkspaceValue(protectedDraft);
      for (const figure of cappedArrayValues(figures, MAX_FIGURES)) {
        if (isPlainObject(figure)) ensureFigureDraft(normalized, figure);
      }
      const result = fitFigureWorkspaceDraftToBudget(normalized, protectedDraft);
      if (preserveCapability) TRUSTED_FIGURE_WORKSPACE_DRAFTS.add(result);
      return result;
    });
  }

  function mergeModelIntoFigureWorkspaceDraft(value, rawFigure, rawModelResult) {
    const current = normalizeFigureWorkspaceDraft(value);
      const figureSource = ownRecord(rawFigure, FIGURE_KEYS);
      const modelSource = ownRecord(rawModelResult, FIGURE_KEYS);
      const figureId = safeId(
        figureSource.figureId || figureSource.id || modelSource.figureId || modelSource.id
      );
      const modelFigureId = safeId(modelSource.figureId || modelSource.id);
      if (!figureId) throw workspaceError('FIGURE_WORKSPACE_ID_INVALID');
      if (modelFigureId && modelFigureId !== figureId) {
        throw workspaceError('FIGURE_WORKSPACE_MODEL_FIGURE_MISMATCH');
      }
      const figureLabel = boundedText(
        figureSource.figureLabel || figureSource.label ||
          modelSource.figureLabel || modelSource.label,
        240
      );
      const isSupplemental = inferSupplemental(
        figureId, figureLabel, figureSource.isSupplemental
      );
      const panelIds = [];
      const seenPanelIds = new Set();
      const collectPanelIds = value => {
        for (const [rawPanelId, rawPanel] of panelEntries(value)) {
          const panel = ownRecord(rawPanel, PANEL_KEYS);
          const panelId = safePanelId(isPlainObject(rawPanel)
            ? panel.panelId || panel.panel || rawPanelId : rawPanelId);
          if (!panelId || seenPanelIds.has(panelId) ||
              panelIds.length >= MAX_PANELS_PER_FIGURE) continue;
          seenPanelIds.add(panelId);
          panelIds.push(panelId);
        }
      };
      collectPanelIds(figureSource.panelHints);
      collectPanelIds(figureSource.panels);
      collectPanelIds(modelSource.panels);
      const next = createFigureWorkspaceDraft([{
        figureId,
        figureLabel,
        isSupplemental,
        panelHints: panelIds
      }], current);
      const targetFigure = next.figures[figureId];
      if (!targetFigure) return current;
      const tracker = createWorkspaceBudgetTracker(next, 1);
      const generated = withNormalizationBudget(() => ({
        overview: normalizeModelOverview({
          figureQuestion: modelSource.figureQuestion,
          coreConclusion: modelSource.coreConclusion,
          claimBoundary: modelSource.claimBoundary,
          authorAssembly: modelSource.authorAssembly,
          remainingQuestion: modelSource.remainingQuestion
        }),
        panels: normalizeModelPanels(
          modelSource.panels, targetFigure.figureLabel, targetFigure.isSupplemental
        ),
        evidenceBlocks: normalizeEvidenceBlocks(
          buildEvidenceBlocks(rawModelResult), false
        )
      }));
      const modelOverview = generated.overview;
      for (const field of OVERVIEW_KEYS) {
        const existing = targetFigure.overview[field];
        const generated = modelOverview[field];
        if (generated && existing.humanReviewed === false && existing.editedAt === 0) {
          tracker.tryReplace(targetFigure.overview, field, generated);
        }
      }
      const modelPanels = generated.panels;
      const modelScalarFields = [...PANEL_SCALAR_FIELDS]
        .filter(field => field !== 'note');
      for (const [panelId, generatedPanel] of cappedMapEntries(
        modelPanels, MAX_PANELS_PER_FIGURE
      )) {
        let targetPanel = targetFigure.panels[panelId];
        if (!targetPanel || targetPanel.provenance === 'manual') continue;
        for (const field of modelScalarFields) {
          const existing = targetPanel[field];
          const generated = generatedPanel[field];
          if (generated && existing.humanReviewed === false && existing.editedAt === 0) {
            if (field === 'directObservation' && (generatedPanel.observationSource !== undefined ||
                targetPanel.observationSource !== undefined)) {
              // Observation and provenance must be admitted together under the size budget.
              const replacement = { ...targetPanel, directObservation: generated,
                observationSource: normalizePanelObservationSource(generatedPanel.observationSource) };
              if (tracker.tryReplace(targetFigure.panels, panelId, replacement)) targetPanel = replacement;
            } else tracker.tryReplace(targetPanel, field, generated);
          }
        }
        for (const field of PANEL_LIST_FIELDS) {
          const existing = targetPanel[field];
          const generated = generatedPanel[field]?.filter(item => item.value);
          if (generated && existing.every(item => item.humanReviewed === false && item.editedAt === 0)) {
            tracker.tryReplace(targetPanel, field, generated);
          }
        }
      }
      const generatedEvidenceBlocks = mergeEvidenceBlockCollections(
        targetFigure.evidenceBlocks, generated.evidenceBlocks, true, targetFigure.evidenceBlockTombstones
      );
      tracker.tryReplace(targetFigure, 'evidenceBlocks', generatedEvidenceBlocks);
      if (semanticDraftFingerprint(next) === semanticDraftFingerprint(current)) return current;
      if (current.revision >= MAX_REVISION) {
        throw workspaceError('FIGURE_WORKSPACE_REVISION_LIMIT');
      }
      next.revision = current.revision + 1;
      return next;
  }

  function mergeFigureWorkspaceValue(manualValue, modelValue) {
    const manual = normalizedEditable(manualValue, false);
    if (manual.humanReviewed || manual.value) return manual.value;
    return boundedText(isPlainObject(modelValue)
      ? ownRecord(modelValue, EDITABLE_KEYS).value : modelValue);
  }

  const FIGURE_WORKSPACE_VIEW_OVERVIEW = Object.freeze([
    ['figureQuestion', '本图问题'],
    ['coreConclusion', '核心结论'],
    ['claimBoundary', '证据边界'],
    ['authorAssembly', '组图逻辑'],
    ['remainingQuestion', '遗留问题']
  ]);
  const FIGURE_WORKSPACE_VIEW_PANEL_FIELDS = Object.freeze([
    ['purpose', '目的', false],
    ['evidenceType', '证据类型', false],
    ['phenotypeName', '表型名称', false],
    ['experimentalMethods', '实验方法', true],
    ['statisticalMethods', '统计方法', true],
    ['design', '设计', false],
    ['comparison', '比较', false],
    ['directObservation', '直接观察', false],
    ['localInference', '局部推断', false],
    ['contribution', '对论证链的贡献', false],
    ['note', '笔记', false]
  ]);

  function normalizePanelObservationSource(value) {
    return ['image_observation', 'caption_statement', 'body_statement', 'multi_source', 'inference']
      .includes(value) ? value : 'inference';
  }

  // Eight-field presentation only. Persist and edit the original component keys.
  function createPanelEightFieldView(value = {}) {
    return withNormalizationBudget(() => {
      const source = ownRecord(value, [...PANEL_KEYS, 'fields']);
      const fieldReviews = new Map((Array.isArray(source.fields)
        ? cappedArrayValues(source.fields, 20) : []).map(item => {
          const record = ownRecord(item, ['key', 'humanReviewed']);
          return [record.key, record.humanReviewed === true];
        }));
      const scalar = key => normalizedEditable(source[key], false, true).value;
      const list = key => normalizedEditableList(source[key], 16, false, true)
        .map(item => item.value).filter(Boolean);
      const reviewed = key => fieldReviews.get(key) === true || (Array.isArray(source[key])
        ? normalizedEditableList(source[key], 16, false, true).some(item => item.humanReviewed)
        : normalizedEditable(source[key], false, true).humanReviewed);
      const field = (key, label, listValue = false) => ({
        key, label, kind: listValue ? 'list' : 'text',
        value: listValue ? list(key) : scalar(key), humanReviewed: reviewed(key)
      });
      const observationSource = normalizePanelObservationSource(source.observationSource);
      const groupComponents = ['design', 'comparison'].map(key => field(key,
        key === 'design' ? '设计/组别' : '比较/对照'));
      const statistics = field('statisticalMethods', '统计方法', true);
      statistics.missing = statistics.value.length === 0;
      statistics.emptyLabel = '未报告';
      const observation = field('directObservation', '图像观察');
      observation.observationSource = observationSource;
      observation.sourceLabel = ({ image_observation: '已提供图像', caption_statement: '据图注描述，未独立核验图像',
        body_statement: '据正文描述，未独立核验图像', multi_source: '多来源，图像是否核验请结合解读依据',
        inference: '未核验图像；旧记录或推断' })[observationSource];
      const phenotype = field('phenotypeName', '表型名称');
      phenotype.emptyLabel = '未明确';
      const methods = field('experimentalMethods', '实验方法', true);
      if (source.experimentalMethods === undefined) {
        const methodKey = text => String(text).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
        const statisticalKeys = new Set(statistics.value.map(methodKey));
        methods.value = list('methods').filter(text => !statisticalKeys.has(methodKey(text)));
      }
      return [field('purpose', '实验目的'), field('evidenceType', '证据类型'), phenotype, methods,
        { key: 'groupDesign', label: '分组设计', kind: 'components',
          value: groupComponents.map(component => component.value
            ? `${component.label}：${component.value}` : '').filter(Boolean).join('\n'),
          components: groupComponents, humanReviewed: groupComponents.some(component => component.humanReviewed),
          storageKeys: ['design', 'comparison'] }, statistics, observation, field('localInference', '实验结论')];
    });
  }

  function mergeFigureWorkspaceList(manualValue, modelValue) {
    const manual = normalizedEditableList(manualValue, 16, false);
    const model = normalizedEditableList(modelValue, 16, false);
    const manualValues = manual.map(item => item.value).filter(Boolean);
    if (manual.some(item => item.humanReviewed) || manualValues.length) {
      return manualValues.slice();
    }
    return model.map(item => item.value).filter(Boolean);
  }

  function evidenceBlocksForView(value) {
    return normalizeEvidenceBlocks(value).map(block => {
      const view = {
        id: block.id,
        ...optionalDisplayName(block),
        kind: block.kind,
        sourceType: block.sourceType,
        panelIds: block.panelIds.slice(),
        fromBlockId: block.fromBlockId,
        toBlockId: block.toBlockId,
        fieldStates: {}
      };
      if (block.provenance === 'manual') {
        view.provenance = 'manual';
        if (block.originalSourceType) {
          view.originalSourceType = block.originalSourceType;
          view.originalPanelIds = block.originalPanelIds.slice();
          if (block.originalSource) {
            view.originalSource = { ...block.originalSource, panelIds: block.originalSource.panelIds.slice() };
            for (const field of EVIDENCE_SCALAR_FIELDS) view.originalSource[field] = block.originalSource[field].value;
          }
        }
        for (const field of MANUAL_EVIDENCE_FIELDS) {
          view[field] = block[field].value;
          view.fieldStates[field] = { ...block[field] };
        }
      }
      for (const field of EVIDENCE_SCALAR_FIELDS) {
        view[field] = block[field].value;
        // Display metadata only. Keep legacy strings and persisted records intact,
        // including an explicitly reviewed blank that must not be filled again.
        view.fieldStates[field] = {
          value: block[field].value,
          humanReviewed: block[field].humanReviewed,
          editedAt: block[field].editedAt
        };
      }
      return view;
    });
  }

  // A display projection only: legacy overlapping groups and unresolved bridges
  // remain intact in storage. Ambiguous ownership is left for review, never guessed.
  function buildFigureEvidenceDisplayLayout(evidenceLayout, viewPanels) {
    const canonical = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
    const panelOrder = new Map();
    cappedArrayValues(viewPanels, MAX_PANEL_IDS_PER_BLOCK).forEach(panel => {
      const id = canonical(panel?.panelId);
      if (id && !panelOrder.has(id)) panelOrder.set(id, panelOrder.size);
    });
    const source = cappedArrayValues(evidenceLayout, MAX_COLLECTION_ITEMS);
    const blocks = source.filter(block => block?.kind === 'evidence' && block.sourceType !== 'bridge')
      .map(block => ({ ...block, panelIds: [...new Set(
        cappedArrayValues(block.panelIds, MAX_PANEL_IDS_PER_BLOCK).map(canonical)
          .filter(id => panelOrder.has(id))
      )] })).filter(block => block.panelIds.length > 0);
    const owners = new Map();
    for (const panelId of panelOrder.keys()) {
      let candidates = blocks.filter(block => block.panelIds.includes(panelId));
      const primary = candidates.filter(block => block.sourceType !== 'argument');
      if (primary.length) candidates = primary;
      // A whole-Figure summary must not swallow a more specific experiment group.
      const specific = candidates.filter(block => !candidates.some(other =>
        other !== block && other.panelIds.length < block.panelIds.length &&
        other.panelIds.every(id => block.panelIds.includes(id))
      ));
      if (specific.length === 1) owners.set(panelId, specific[0]);
    }
    const visible = blocks.map(block => ({
      ...block,
      panelIds: block.panelIds.filter(id => block.provenance === 'manual' || owners.get(id) === block)
        .sort((a, b) => panelOrder.get(a) - panelOrder.get(b))
    })).filter(block => block.panelIds.length > 0)
      .sort((a, b) => panelOrder.get(a.panelIds[0]) - panelOrder.get(b.panelIds[0]));
    const ids = new Set(visible.map(block => block.id));
    // Transition records supply the next block's single upstream sentence only.
    const transitions = source.filter(block =>
      (block?.kind === 'transition' || block?.sourceType === 'bridge') &&
      ids.has(block.fromBlockId) && ids.has(block.toBlockId)
    ).map(block => ({ ...block, kind: 'transition' }));
    return [...visible, ...transitions];
  }

  function prepareFigureWorkspaceViewContext(draft = null) {
    const strictIdentities = createSafeMap();
    const source = ownRecord(draft, ROOT_KEYS);
    const rawFigures = Array.isArray(source.figures)
      ? cappedArrayValues(source.figures, MAX_FIGURES).map(rawFigure => {
        const record = ownRecord(rawFigure, FIGURE_KEYS);
        return [record.figureId || record.id, rawFigure];
      })
      : cappedMapEntries(source.figures, MAX_FIGURES);
    for (const [fallbackId, rawFigure] of rawFigures) {
      const record = ownRecord(rawFigure, FIGURE_KEYS);
      const figureId = strictDescriptorFigureId(
        record.figureId || record.id || fallbackId
      );
      if (!figureId) continue;
      const panelIds = strictIdentities[figureId] || new Set();
      for (const [rawId, rawPanel] of panelEntries(record.panels)) {
        const panel = ownRecord(rawPanel, PANEL_KEYS);
        const panelId = strictDescriptorPanelId(isPlainObject(rawPanel)
          ? panel.panelId || panel.panel || rawId : rawId);
        if (panelId) panelIds.add(panelId);
      }
      strictIdentities[figureId] = panelIds;
    }
    const normalizedDraft = publicFigureWorkspaceDraft(draft);
    const figureIndex = createSafeMap();
    for (const [figureId, figure] of cappedMapEntries(
      normalizedDraft.figures, MAX_FIGURES
    )) {
      const allowedPanelIds = strictIdentities[figureId];
      if (!allowedPanelIds) continue;
      const panels = createSafeMap();
      for (const [panelId, panel] of cappedMapEntries(
        figure.panels, MAX_PANELS_PER_FIGURE
      )) {
        if (allowedPanelIds.has(panelId)) panels[panelId] = panel;
      }
      figureIndex[figureId] = { ...figure, panels };
    }
    Object.freeze(figureIndex);
    const context = {
      schemaVersion: FIGURE_WORKSPACE_DRAFT_VERSION,
      revision: normalizedDraft.revision,
      figureIndex
    };
    Object.defineProperty(context, PREPARED_FIGURE_WORKSPACE_VIEW_CONTEXT, {
      value: true
    });
    return Object.freeze(context);
  }

  function figureWorkspaceViewInputFingerprint({ figure, modelResult = null } = {}) {
    return withNormalizationBudget(() => {
      const effectiveInventory = resultBindingContracts?.resolveFigurePanelInventory?.(figure);
      const figureSource = ownRecord(figure, FIGURE_KEYS);
      const modelSource = ownRecord(modelResult, FIGURE_KEYS);
      const figureId = strictDescriptorFigureId(
        figureSource.figureId || figureSource.id || modelSource.figureId || modelSource.id
      );
      if (!figureId) throw workspaceError('FIGURE_WORKSPACE_ID_INVALID');
      const inventoryFigure = normalizeFigureForView(effectiveInventory?.inventoryMatched
        ? { ...figureSource, panelHints: effectiveInventory.panelHints } : figure, figureId);
      const figureLabel = inventoryFigure?.figureLabel || boundedText(
        figureSource.figureLabel || figureSource.label ||
          modelSource.figureLabel || modelSource.label,
        240
      );
      const isSupplemental = inventoryFigure?.isSupplemental ?? inferSupplemental(
        figureId, figureLabel, figureSource.isSupplemental
      );
      const panelAnalysisSource = ownRecord(figure, ['panelAnalyses']);
      const directoryProof = ownRecord(figure, ['panelDirectoryTrusted', 'sourceMismatch']);
      const modelOverview = normalizeOverview({
        figureQuestion: modelSource.figureQuestion,
        coreConclusion: modelSource.coreConclusion,
        claimBoundary: modelSource.claimBoundary,
        authorAssembly: modelSource.authorAssembly,
        remainingQuestion: modelSource.remainingQuestion
      }, false);
      return JSON.stringify({
        figureId,
        figureLabel,
        inventoryFigure,
        ...(effectiveInventory?.inventoryMatched ? {
          effectiveInventoryBinding: effectiveInventory.binding,
          inventoryCoverageComplete: effectiveInventory.coverageComplete
        } : {}),
        panelDirectoryTrusted: directoryProof.panelDirectoryTrusted === true,
        sourceMismatch: directoryProof.sourceMismatch === true,
        modelOverview,
        modelPanels: normalizePanelsForView(
          modelSource.panels, figureLabel, false, isSupplemental
        ),
        onDemandPanels: normalizePanelsForView(
          panelAnalysisSource.panelAnalyses, figureLabel, false, isSupplemental
        )
      });
    });
  }

  function isPreparedFigureWorkspaceViewContext(value) {
    return Boolean(value?.[PREPARED_FIGURE_WORKSPACE_VIEW_CONTEXT]);
  }

  function createFigureWorkspaceView({
    figure, modelResult = null, draft = null, context = null
  } = {}) {
    const preparedContext = isPreparedFigureWorkspaceViewContext(context)
      ? context : prepareFigureWorkspaceViewContext(draft);
    return withNormalizationBudget(() => {
      const effectiveInventory = resultBindingContracts?.resolveFigurePanelInventory?.(figure);
      const figureSource = ownRecord(figure, FIGURE_KEYS);
      const modelSource = ownRecord(modelResult, FIGURE_KEYS);
      const figureId = strictDescriptorFigureId(
        figureSource.figureId || figureSource.id || modelSource.figureId || modelSource.id
      );
      if (!figureId) throw workspaceError('FIGURE_WORKSPACE_ID_INVALID');
      const draftFigure = figureId && Object.hasOwn(preparedContext.figureIndex, figureId)
        ? preparedContext.figureIndex[figureId] : null;
      const inventoryFigure = normalizeFigureForView(effectiveInventory?.inventoryMatched
        ? { ...figureSource, panelHints: effectiveInventory.panelHints } : figure, figureId);
      const directoryProof = ownRecord(figure, ['panelDirectoryTrusted', 'panelHints', 'sourceMismatch']);
      if (effectiveInventory?.inventoryMatched) directoryProof.panelHints = effectiveInventory.panelHints;
      const trustedPanelIds = directoryProof.panelDirectoryTrusted === true
        ? new Set(Object.keys(Array.isArray(directoryProof.panelHints)
          ? normalizeFigureForView({ figureId, figureLabel: inventoryFigure.figureLabel,
            isSupplemental: inventoryFigure.isSupplemental, panelHints: directoryProof.panelHints }).panels
          : inventoryFigure.panels)) : null;
      if (trustedPanelIds) for (const [panelId, panel] of cappedMapEntries(draftFigure?.panels, MAX_PANELS_PER_FIGURE)) {
        if (panel.provenance === 'manual') trustedPanelIds.add(panelId);
      }
      const figureLabel = inventoryFigure?.figureLabel || draftFigure?.figureLabel ||
        boundedText(figureSource.figureLabel || figureSource.label ||
          modelSource.figureLabel || modelSource.label, 240);
      const isSupplemental = inventoryFigure?.isSupplemental ?? draftFigure?.isSupplemental ??
        inferSupplemental(figureId, figureLabel, figureSource.isSupplemental);
      const modelPanels = normalizePanelsForView(
        modelSource.panels, figureLabel, false, isSupplemental
      );
      const panelAnalysisSource = ownRecord(figure, ['panelAnalyses']);
      const onDemandPanels = normalizePanelsForView(
        panelAnalysisSource.panelAnalyses, figureLabel, false, isSupplemental
      );
      const blankOverview = emptyOverview();
      const manualOverview = draftFigure?.overview || inventoryFigure?.overview || blankOverview;
      const modelOverview = normalizeOverview({
        figureQuestion: modelSource.figureQuestion,
        coreConclusion: modelSource.coreConclusion,
        claimBoundary: modelSource.claimBoundary,
        authorAssembly: modelSource.authorAssembly,
        remainingQuestion: modelSource.remainingQuestion
      }, false);
      const overview = FIGURE_WORKSPACE_VIEW_OVERVIEW.map(([key, label]) => ({
        key,
        label,
        value: manualOverview[key]?.editedAt > 0 ? manualOverview[key].value
          : mergeFigureWorkspaceValue(manualOverview[key], modelOverview[key]),
        humanReviewed: manualOverview[key]?.humanReviewed === true
      }));

      const panelIds = [];
      const seenPanelIds = new Set();
      const collectPanels = panels => {
        for (const [panelId] of cappedMapEntries(panels, MAX_PANELS_PER_FIGURE)) {
          if (!seenPanelIds.has(panelId) && panelIds.length < MAX_PANELS_PER_FIGURE) {
            seenPanelIds.add(panelId);
            panelIds.push(panelId);
          }
        }
      };
      collectPanels(inventoryFigure?.panels);
      collectPanels(draftFigure?.panels);
      collectPanels(onDemandPanels);
      collectPanels(modelPanels);

      const panels = panelIds.map(panelId => {
        const manualPanel = draftFigure?.panels?.[panelId] ||
          inventoryFigure?.panels?.[panelId] || emptyPanel(
            panelId, figureLabel, isSupplemental
          );
        const modelPanel = manualPanel.provenance === 'manual'
          ? emptyPanel(panelId, figureLabel, isSupplemental)
          : modelPanels[panelId] || onDemandPanels[panelId] || emptyPanel(panelId, figureLabel, isSupplemental);
        const panel = createFigureWorkspacePanelDescriptor({
          figureId, figureLabel, isSupplemental, panelId
        });
        Object.assign(panel, optionalDisplayName(manualPanel));
        if (manualPanel.provenance === 'manual') panel.provenance = 'manual';
        const fields = FIGURE_WORKSPACE_VIEW_PANEL_FIELDS.map(([key, label, list]) => {
          const manualList = list ? normalizedEditableList(manualPanel[key], 16, false) : null;
          const preserveEdited = list ? manualList.some(item => item.editedAt > 0)
            : manualPanel[key]?.editedAt > 0;
          const value = preserveEdited
            ? (list ? manualList.map(item => item.value).filter(Boolean) : manualPanel[key].value)
            : (list ? mergeFigureWorkspaceList(manualPanel[key], modelPanel[key])
              : mergeFigureWorkspaceValue(manualPanel[key], modelPanel[key]));
          panel[key] = Array.isArray(value) ? value.slice() : value;
          return {
            key,
            label,
            kind: list ? 'list' : 'text',
            value: Array.isArray(value) ? value.slice() : value,
            humanReviewed: list
              ? normalizedEditableList(manualPanel[key], 16, false)
                .some(item => item.humanReviewed)
              : manualPanel[key]?.humanReviewed === true
          };
        });
        panel.fields = fields;
        const manualObservation = normalizedEditable(manualPanel.directObservation, false, true);
        const observationOwner = (manualObservation.humanReviewed || manualObservation.editedAt > 0 ||
          manualObservation.value) && panel.directObservation === manualObservation.value
          ? manualPanel : modelPanel;
        panel.observationSource = normalizePanelObservationSource(observationOwner.observationSource);
        panel.eightFields = createPanelEightFieldView(panel);
        panel.compatibilityFields = fields.filter(field => ['contribution', 'note'].includes(field.key));
        return panel;
      });
      const evidenceBlocks = draftFigure
        ? evidenceBlocksForView(draftFigure.evidenceBlocks)
        : inventoryFigure?.evidenceBlocks?.length
          ? evidenceBlocksForView(inventoryFigure.evidenceBlocks)
          : evidenceBlocksForView(normalizeEvidenceBlocks(
          buildEvidenceBlocks(modelResult), false
        ));

      const activePanels = trustedPanelIds ? panels.filter(panel => trustedPanelIds.has(panel.panelId)) : panels;
      const historicalPanels = trustedPanelIds ? panels.filter(panel => !trustedPanelIds.has(panel.panelId))
        .map(panel => ({ ...panel, sourceMismatch: true })) : [];
      const activeEvidenceBlocks = trustedPanelIds ? evidenceBlocks.filter(block =>
        block.panelIds.every(panelId => trustedPanelIds.has(panelId))) : evidenceBlocks;
      const historicalEvidenceBlocks = trustedPanelIds ? evidenceBlocks.filter(block =>
        block.panelIds.some(panelId => !trustedPanelIds.has(panelId))) : [];
      return {
        figureId,
        figureLabel,
        figureAnchorId: figureId ? figureWorkspaceAnchorId('figure', figureId) : '',
        ...optionalDisplayName(manualOverview),
        isSupplemental,
        overview,
        panels: activePanels,
        evidenceBlocks: activeEvidenceBlocks,
        ...(draftFigure?.manualEvidenceArchive?.length ? { manualEvidenceArchive: draftFigure.manualEvidenceArchive.map(entry => ({
          id: entry.id, blockId: entry.blockId, mergedIntoBlockId: entry.mergedIntoBlockId, mergedAt: entry.mergedAt,
          block: evidenceBlocksForView([entry.block])[0],
          panels: Object.values(entry.panels).map(panel => ({
            ...createFigureWorkspacePanelDescriptor({ figureId, figureLabel, isSupplemental, panelId: panel.panelId }),
            ...optionalDisplayName(panel),
            ...(panel.provenance === 'manual' ? { provenance: 'manual' } : {}),
            ...Object.fromEntries([...PANEL_SCALAR_FIELDS].map(field => [field, panel[field].value])),
            ...Object.fromEntries([...PANEL_LIST_FIELDS].map(field => [field, panel[field].map(item => item.value)]))
          }))
        })) } : {}),
        ...(historicalPanels.length ? { historicalPanels } : {}),
        ...(historicalEvidenceBlocks.length ? { historicalEvidenceBlocks } : {}),
        ...(directoryProof.sourceMismatch === true ? { sourceMismatch: true } : {})
      };
    });
  }

  function workspaceError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function requireSafeId(value, code = 'FIGURE_WORKSPACE_TARGET_NOT_FOUND') {
    const id = safeId(value);
    if (!id) throw workspaceError(code);
    return id;
  }

  function requireFigure(draft, figureId) {
    const id = requireSafeId(figureId);
    if (!Object.hasOwn(draft.figures, id)) {
      throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
    }
    return draft.figures[id];
  }

  function requirePanel(draft, figureId, panelId) {
    const figure = requireFigure(draft, figureId);
    const id = safePanelId(panelId);
    if (!id || !Object.hasOwn(figure.panels, id)) {
      throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
    }
    return figure.panels[id];
  }

  function requireExistingPanelKey(draft, figureId, panelId) {
    const figure = requireFigure(draft, figureId);
    const panel = requirePanel(draft, figure.figureId, panelId);
    return mechanismPanelKey(figure.figureId, panel.panelId);
  }

  function reviewedValue(value, now) {
    return editableValue(boundedText(value), true, boundedTimestamp(now));
  }

  function reviewedList(value, now, maximum = 16) {
    if (!Array.isArray(value)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const items = cappedArrayValues(value, maximum)
      .map(item => reviewedValue(isPlainObject(item) ? ownRecord(item, EDITABLE_KEYS).value : item, now));
    return items.length ? items : [reviewedValue('', now)];
  }

  function unlockedList(value, maximum = 16) {
    if (!Array.isArray(value)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    return cappedArrayValues(value, maximum).map(item => editableValue(
      boundedText(isPlainObject(item) ? ownRecord(item, EDITABLE_KEYS).value : item), false, 0
    ));
  }

  function requireAllowedField(field, allowed) {
    if (typeof field !== 'string') throw workspaceError('FIGURE_WORKSPACE_FIELD_INVALID');
    const normalized = field;
    if (!allowed.has(normalized)) throw workspaceError('FIGURE_WORKSPACE_FIELD_INVALID');
    return normalized;
  }

  function requireCollectionIndex(value, length, allowEnd = false) {
    const index = value;
    const maximum = allowEnd ? length : length - 1;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) ||
        index < 0 || index > maximum) {
      throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
    }
    return index;
  }

  function evidenceBlockCollection(draft, figureId = '') {
    return figureId ? requireFigure(draft, figureId).evidenceBlocks : draft.evidenceBlocks;
  }

  function requireEvidenceBlock(draft, blockId, figureId = '') {
    const id = requireSafeId(blockId);
    const block = evidenceBlockCollection(draft, figureId).find(item => item.id === id);
    if (!block) throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
    return block;
  }

  function requireMechanismItem(items, idValue) {
    const id = requireSafeId(idValue);
    const item = items.find(candidate => candidate.id === id);
    if (!item) throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
    return item;
  }

  function requireOptionalPrimitiveStrings(record, fields) {
    for (const field of fields) {
      if (Object.hasOwn(record, field) && typeof record[field] !== 'string') {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
    }
  }

  function addEvidenceBlock(draft, value, now, figureId = '') {
    const blocks = evidenceBlockCollection(draft, figureId);
    if (!isPlainObject(value) || blocks.length >= MAX_COLLECTION_ITEMS) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const source = ownRecord(value, EVIDENCE_BLOCK_KEYS);
    const id = requireSafeId(source.id, 'FIGURE_WORKSPACE_VALUE_INVALID');
    if (blocks.some(block => block.id === id)) {
      throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
    }
    const panelIds = cappedArrayValues(source.panelIds, MAX_PANEL_IDS_PER_BLOCK)
      .map(safePanelId).filter(Boolean);
    const block = {
      id,
      kind: source.kind === 'transition' ? 'transition' : 'evidence',
      sourceType: 'manual',
      panelIds,
      fromBlockId: safeId(source.fromBlockId, 80),
      toBlockId: safeId(source.toBlockId, 80)
    };
    for (const field of EVIDENCE_SCALAR_FIELDS) {
      block[field] = reviewedValue(source[field], now);
    }
    blocks.push(block);
  }

  function manualEvidenceBlockSource(value, partial = false) {
    const keys = partial ? ['panelIds', ...MANUAL_EVIDENCE_FIELDS] : ['id', 'panelIds', ...MANUAL_EVIDENCE_FIELDS];
    const source = strictOwnDataRecord(value, partial ? [] : ['id', 'panelIds'], keys);
    if (!source || !strictImportOwnDataShape(value, keys)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    if (Object.hasOwn(source, 'id') && (typeof source.id !== 'string' || source.id.length > 80 || safeId(source.id, 80) !== source.id)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    for (const field of MANUAL_EVIDENCE_FIELDS) if (Object.hasOwn(source, field) &&
        (typeof source[field] !== 'string' || source[field].length > MAX_TEXT_LENGTH)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    if (Object.hasOwn(source, 'panelIds')) {
      const rawPanels = strictGeneratedArray(source.panelIds, MAX_PANEL_IDS_PER_BLOCK);
      if (!rawPanels?.length || rawPanels.some(value => typeof value !== 'string' || !safePanelId(value))) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      source.panelIds = [...new Set(rawPanels.map(safePanelId))];
    }
    return source;
  }

  function ensureManualEvidencePanels(figure, panelIds, createMissingPanels) {
    const missing = panelIds.filter(panelId => !Object.hasOwn(figure.panels, panelId));
    if (missing.length && createMissingPanels !== true) throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
    if (Object.keys(figure.panels).length + missing.length > MAX_PANELS_PER_FIGURE) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    for (const panelId of missing) figure.panels[panelId] = {
      ...emptyPanel(panelId, figure.figureLabel, figure.isSupplemental), provenance: 'manual'
    };
  }

  function manualEvidenceBlockValues(block, figure) {
    const scalar = value => normalizedEditable(value, false).value;
    if (block.provenance === 'manual') return Object.fromEntries(
      [...MANUAL_EVIDENCE_FIELDS].map(field => [field, scalar(block[field])])
    );
    const panels = block.panelIds.map(panelId => figure?.panels?.[panelId]).filter(Boolean);
    return {
      title: scalar(block.groupGoal) || scalar(block.groupConclusion) || scalar(block.established),
      method: scalar(block.method) || boundedText(panels.map(panel => normalizedEditableList(panel.experimentalMethods, 16, false).map(item => item.value).filter(Boolean).join('；')).filter(Boolean).join('；')),
      observation: scalar(block.observation) || boundedText(panels.map(panel => scalar(panel.directObservation)).filter(Boolean).join('；')),
      conclusion: scalar(block.groupConclusion) || scalar(block.established) || scalar(block.groupGoal)
    };
  }

  function promoteManualEvidenceBlock(block, figure, now) {
    if (block.provenance === 'manual') return;
    const values = manualEvidenceBlockValues(block, figure);
    block.originalSourceType = block.sourceType;
    block.originalPanelIds = block.panelIds.slice();
    block.originalSource = { kind: block.kind, sourceType: block.sourceType, panelIds: block.panelIds.slice() };
    for (const field of EVIDENCE_SCALAR_FIELDS) block.originalSource[field] = { ...block[field] };
    block.provenance = 'manual'; block.sourceType = 'manual';
    for (const field of MANUAL_EVIDENCE_FIELDS) block[field] = reviewedValue(values[field], now);
  }

  function requireGroupableEvidenceBlock(draft, blockId, figureId) {
    const block = requireEvidenceBlock(draft, blockId, figureId);
    if (block.kind !== 'evidence' || block.sourceType === 'bridge' || !block.panelIds.length) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    return block;
  }

  function recordReplacedEvidenceBlock(figure, block) {
    if (!figure) return;
    const origin = block.provenance === 'manual' && block.originalSource
      ? { id: block.id, ...block.originalSource } : block;
    const identity = regeneratableEvidenceBlockIdentity(origin);
    if (!identity) return;
    figure.evidenceBlockTombstones ||= [];
    if (figure.evidenceBlockTombstones.some(item => regeneratableEvidenceBlockIdentity(item) === identity)) return;
    if (figure.evidenceBlockTombstones.length >= MAX_COLLECTION_ITEMS) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    figure.evidenceBlockTombstones.push(normalizeEvidenceBlocks([origin])[0]);
  }

  function preserveUnchangedTakeoverJudgments(draft, figure, block, previousSource, previousValues, previousPanelIds) {
    // Ownership alone is not a new scientific judgment. Only acknowledge the
    // representation change for bindings that still match the old live source.
    if (!previousSource || previousPanelIds.length !== block.panelIds.length ||
        previousPanelIds.some(panelId => !block.panelIds.includes(panelId)) ||
        JSON.stringify(previousValues) !== JSON.stringify(manualEvidenceBlockValues(block, figure))) return;
    const nextSource = canvasContracts?.mechanismCanvasSources(draft.figures).find(source => source.figureId === figure.figureId && source.blockId === block.id);
    if (!nextSource) return;
    for (const binding of draft.mechanismChain.drawing?.bindings || []) {
      if (binding.figureId !== figure.figureId || binding.blockId !== block.id || binding.unresolved ||
          binding.panelIds.length !== previousPanelIds.length || binding.panelIds.some(panelId => !previousPanelIds.includes(panelId)) ||
          (binding.sourceFingerprint && binding.sourceFingerprint !== previousSource.sourceFingerprint) ||
          (binding.contentFingerprint && binding.contentFingerprint !== previousSource.contentFingerprint)) continue;
      binding.sourceFingerprint = nextSource.sourceFingerprint;
      binding.contentFingerprint = nextSource.contentFingerprint;
    }
  }

  function mutateManualEvidenceBlock(draft, mutation, now) {
    const figure = requireFigure(draft, mutation.figureId), isUpdate = mutation.type === 'update_manual_evidence_block';
    if (mutation.createMissingPanels !== undefined && typeof mutation.createMissingPanels !== 'boolean') throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const source = manualEvidenceBlockSource(mutation.block, isUpdate);
    let block;
    if (isUpdate) {
      block = requireGroupableEvidenceBlock(draft, mutation.blockId, figure.figureId);
    } else {
      const id = requireSafeId(source.id, 'FIGURE_WORKSPACE_VALUE_INVALID');
      if (figure.evidenceBlocks.some(block => block.id === id)) throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
      if (figure.evidenceBlocks.length >= MAX_COLLECTION_ITEMS) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      block = { id, kind: 'evidence', sourceType: 'manual', provenance: 'manual', panelIds: [], fromBlockId: '', toBlockId: '' };
      for (const field of EVIDENCE_SCALAR_FIELDS) block[field] = editableValue();
      for (const field of MANUAL_EVIDENCE_FIELDS) block[field] = reviewedValue('', now);
    }
    const takeover = isUpdate && block.provenance !== 'manual';
    const previousValues = manualEvidenceBlockValues(block, figure), previousPanelIds = block.panelIds.slice();
    const previousSource = takeover && canvasContracts?.mechanismCanvasSources(draft.figures).find(source => source.figureId === figure.figureId && source.blockId === block.id);
    const panelIds = source.panelIds || block.panelIds;
    ensureManualEvidencePanels(figure, panelIds, mutation.createMissingPanels);
    if (isUpdate) recordReplacedEvidenceBlock(figure, block);
    if (takeover) promoteManualEvidenceBlock(block, figure, now);
    block.panelIds = panelIds.slice();
    for (const field of MANUAL_EVIDENCE_FIELDS) if (Object.hasOwn(source, field)) block[field] = reviewedValue(source[field], now);
    if (!isUpdate) figure.evidenceBlocks.push(block);
    if (takeover) preserveUnchangedTakeoverJudgments(draft, figure, block, previousSource, previousValues, previousPanelIds);
  }

  function manualEvidenceDescription(value) {
    const source = manualEvidenceBlockSource(value === undefined ? {} : value, true);
    if (Object.hasOwn(source, 'panelIds')) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    return source;
  }

  function splitManualEvidenceBlock(draft, mutation, now) {
    const figure = requireFigure(draft, mutation.figureId);
    const block = requireGroupableEvidenceBlock(draft, mutation.blockId, figure.figureId);
    const moved = manualEvidenceBlockSource({ panelIds: mutation.panelIds }, true).panelIds;
    const description = manualEvidenceDescription(mutation.block);
    if (moved.length >= block.panelIds.length || moved.some(panelId => !block.panelIds.includes(panelId))) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const remaining = block.panelIds.filter(panelId => !moved.includes(panelId));
    // Both operations act on this private draft. The caller publishes one CAS
    // revision; failed allocation leaves neither half of the split persisted.
    mutateManualEvidenceBlock(draft, { type: 'update_manual_evidence_block', figureId: figure.figureId,
      blockId: block.id, block: { panelIds: remaining } }, now);
    mutateManualEvidenceBlock(draft, { type: 'add_manual_evidence_block', figureId: figure.figureId,
      block: { id: mutation.newBlockId, panelIds: moved, ...description } }, now);
  }

  function mergeManualEvidenceBlocks(draft, mutation, now) {
    const figure = requireFigure(draft, mutation.figureId);
    const block = requireGroupableEvidenceBlock(draft, mutation.blockId, figure.figureId);
    const ids = strictGeneratedArray(mutation.sourceBlockIds, MAX_COLLECTION_ITEMS - 1);
    if (!ids?.length || ids.some(value => typeof value !== 'string' || value.length > 80 || safeId(value, 80) !== value || value === block.id) || new Set(ids).size !== ids.length) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const sources = ids.map(id => requireGroupableEvidenceBlock(draft, id, figure.figureId));
    const panelIds = [...new Set([block, ...sources].flatMap(item => item.panelIds))];
    const description = manualEvidenceDescription(mutation.block);
    const archive = figure.manualEvidenceArchive || [];
    if (archive.length + sources.length > MAX_COLLECTION_ITEMS) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const archiveIds = new Set(archive.map(entry => entry.id));
    const archivedSources = sources.map((source, index) => ({
      id: allocateEvidenceBlockId(`manual-merge-${draft.revision + 1}-${index + 1}`, archiveIds),
      blockId: source.id, mergedIntoBlockId: block.id, mergedAt: boundedTimestamp(now),
      block: cloneNormalizedWorkspaceValue(source),
      panels: Object.fromEntries(source.panelIds.filter(panelId => Object.hasOwn(figure.panels, panelId))
        .map(panelId => [panelId, cloneNormalizedWorkspaceValue(figure.panels[panelId])]))
    }));
    mutateManualEvidenceBlock(draft, { type: 'update_manual_evidence_block', figureId: figure.figureId,
      blockId: block.id, block: { panelIds, ...description } }, now);
    for (const source of sources) recordReplacedEvidenceBlock(figure, source);
    figure.manualEvidenceArchive = [...archive, ...archivedSources];
    figure.evidenceBlocks = figure.evidenceBlocks.filter(item => !ids.includes(item.id));
  }

  function mechanismReviewTombstones(chain) {
    chain.reviewTombstones ||= emptyMechanismReviewTombstones();
    return chain.reviewTombstones;
  }

  function addMechanismNodeTombstone(chain, node, now) {
    const tombstones = mechanismReviewTombstones(chain);
    const existing = tombstones.nodes.find(item => item.id === node.id);
    if (existing) {
      existing.editedAt = boundedTimestamp(now);
      return;
    }
    if (tombstones.nodes.length >= MAX_COLLECTION_ITEMS) {
      throw workspaceError('FIGURE_WORKSPACE_REVIEW_TOMBSTONE_CAPACITY');
    }
    tombstones.nodes.push({ id: node.id, editedAt: boundedTimestamp(now) });
  }

  function addMechanismEdgeTombstone(chain, edge, now) {
    const tombstones = mechanismReviewTombstones(chain);
    const existing = tombstones.edges.find(item =>
      item.id === edge.id && item.from === edge.from && item.to === edge.to
    );
    if (existing) {
      existing.editedAt = boundedTimestamp(now);
      return;
    }
    if (tombstones.edges.length >= MAX_COLLECTION_ITEMS) {
      throw workspaceError('FIGURE_WORKSPACE_REVIEW_TOMBSTONE_CAPACITY');
    }
    tombstones.edges.push({
      id: edge.id, from: edge.from, to: edge.to, editedAt: boundedTimestamp(now)
    });
  }

  function addMechanismEvidenceTombstone(chain, edge, evidence, now) {
    if (!evidence.figureId || !evidence.panelId) return;
    const tombstones = mechanismReviewTombstones(chain);
    const existing = tombstones.evidence.find(item =>
      item.edgeId === edge.id && item.from === edge.from && item.to === edge.to &&
      item.figureId === evidence.figureId && item.panelId === evidence.panelId
    );
    if (existing) {
      existing.editedAt = boundedTimestamp(now);
      return;
    }
    if (tombstones.evidence.length >= 512) {
      throw workspaceError('FIGURE_WORKSPACE_REVIEW_TOMBSTONE_CAPACITY');
    }
    tombstones.evidence.push({
      edgeId: edge.id, from: edge.from, to: edge.to,
      figureId: evidence.figureId, panelId: evidence.panelId,
      editedAt: boundedTimestamp(now)
    });
  }

  function clearMechanismNodeTombstone(chain, nodeId) {
    const tombstones = mechanismReviewTombstones(chain);
    tombstones.nodes = tombstones.nodes.filter(item => item.id !== nodeId);
  }

  function clearMechanismEdgeTombstone(chain, edge) {
    const tombstones = mechanismReviewTombstones(chain);
    const exact = tombstones.edges.some(item =>
      item.id === edge.id && item.from === edge.from && item.to === edge.to
    );
    if (exact) {
      tombstones.edges = tombstones.edges.filter(item =>
        item.id !== edge.id || item.from !== edge.from || item.to !== edge.to
      );
      return;
    }
    const endpointTombstones = tombstones.edges.filter(item =>
      item.from === edge.from && item.to === edge.to
    );
    const endpointEdges = chain.edges.filter(item =>
      item.from === edge.from && item.to === edge.to
    );
    if (endpointTombstones.length !== 1 || endpointEdges.length !== 1 ||
        endpointEdges[0] !== edge) return;
    const target = endpointTombstones[0];
    tombstones.edges = tombstones.edges.filter(item =>
      item.id !== target.id || item.from !== target.from || item.to !== target.to
    );
  }

  function clearMechanismEvidenceTombstone(chain, edge, evidence) {
    const tombstones = mechanismReviewTombstones(chain);
    const exact = tombstones.evidence.some(item =>
      item.edgeId === edge.id && item.from === edge.from && item.to === edge.to &&
      item.figureId === evidence.figureId && item.panelId === evidence.panelId
    );
    if (exact) {
      tombstones.evidence = tombstones.evidence.filter(item =>
        item.edgeId !== edge.id || item.from !== edge.from || item.to !== edge.to ||
        item.figureId !== evidence.figureId || item.panelId !== evidence.panelId
      );
      return;
    }
    const endpointTombstones = tombstones.evidence.filter(item =>
      item.from === edge.from && item.to === edge.to &&
      item.figureId === evidence.figureId && item.panelId === evidence.panelId
    );
    const endpointEdges = chain.edges.filter(item =>
      item.from === edge.from && item.to === edge.to
    );
    if (endpointTombstones.length !== 1 || endpointEdges.length !== 1 ||
        endpointEdges[0] !== edge) return;
    const target = endpointTombstones[0];
    tombstones.evidence = tombstones.evidence.filter(item =>
      item.edgeId !== target.edgeId || item.from !== target.from || item.to !== target.to ||
      item.figureId !== target.figureId || item.panelId !== target.panelId
    );
  }

  function addMechanismNode(draft, value, now) {
    if (!isPlainObject(value) || draft.mechanismChain.nodes.length >= MAX_COLLECTION_ITEMS) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const source = ownRecord(value, NODE_KEYS);
    requireOptionalPrimitiveStrings(source, NODE_KEYS);
    const id = requireSafeId(source.id, 'FIGURE_WORKSPACE_VALUE_INVALID');
    if (draft.mechanismChain.nodes.some(node => node.id === id)) {
      throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
    }
    draft.mechanismChain.nodes.push({ id, label: reviewedValue(source.label, now) });
    clearMechanismNodeTombstone(draft.mechanismChain, id);
    draft.mechanismChain.initialized = true;
  }

  function nextMechanismEdgeId(draft, preferred = '') {
    const requested = safeId(preferred, 80);
    if (requested && !draft.mechanismChain.edges.some(edge => edge.id === requested)) {
      return requested;
    }
    for (let index = 1; index <= MAX_COLLECTION_ITEMS + 1; index += 1) {
      const id = `mechanism-edge-${index}`;
      if (!draft.mechanismChain.edges.some(edge => edge.id === id)) return id;
    }
    throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
  }

  function insertMechanismNode(draft, value, index, edgeId, now) {
    if (edgeId !== undefined && typeof edgeId !== 'string') {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const insertion = requireCollectionIndex(index, draft.mechanismChain.nodes.length, true);
    addMechanismNode(draft, value, now);
    const node = draft.mechanismChain.nodes.pop();
    draft.mechanismChain.nodes.splice(insertion, 0, node);
  }

  function removeMechanismNode(draft, nodeId, now) {
    const chain = draft.mechanismChain;
    const node = requireMechanismItem(chain.nodes, nodeId);
    const incidentEdges = chain.edges.filter(edge =>
      edge.from === node.id || edge.to === node.id);
    addMechanismNodeTombstone(chain, node, now);
    incidentEdges.forEach(edge => addMechanismEdgeTombstone(chain, edge, now));
    const index = chain.nodes.indexOf(node);
    chain.nodes.splice(index, 1);
    chain.edges = chain.edges.filter(edge =>
      edge.from !== node.id && edge.to !== node.id);
    chain.initialized = true;
  }

  function requireMechanismPolarity(value, allowDefault = true) {
    if (value === undefined && allowDefault) return 'neutral';
    if (typeof value !== 'string' || !MECHANISM_POLARITIES.has(value)) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    return value;
  }

  function mechanismEdgeLabelValue(edge) {
    return isPlainObject(edge?.label)
      ? boundedText(ownRecord(edge.label, EDITABLE_KEYS).value)
      : boundedText(edge?.label);
  }

  function exactMechanismEdgeDuplicate(edges, candidate, ignoredId = '') {
    const label = mechanismEdgeLabelValue(candidate);
    return edges.some(edge => edge.id !== ignoredId &&
      edge.from === candidate.from && edge.to === candidate.to &&
      normalizeMechanismPolarity(edge.polarity) === candidate.polarity &&
      mechanismEdgeLabelValue(edge) === label);
  }

  function validateMechanismEdgeSemantics(draft, candidate, ignoredId = '') {
    if (!draft.mechanismChain.nodes.some(node => node.id === candidate.from) ||
        !draft.mechanismChain.nodes.some(node => node.id === candidate.to)) {
      throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
    }
    if (candidate.from === candidate.to && candidate.polarity === 'neutral') {
      throw workspaceError('FIGURE_WORKSPACE_MECHANISM_SELF_LOOP_POLARITY_REQUIRED');
    }
    if (exactMechanismEdgeDuplicate(
      draft.mechanismChain.edges, candidate, ignoredId
    )) throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
  }

  function addMechanismEdge(draft, value, now) {
    if (!isPlainObject(value) || draft.mechanismChain.edges.length >= MAX_COLLECTION_ITEMS) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const source = ownRecord(value, EDGE_KEYS);
    requireOptionalPrimitiveStrings(source, ['id', 'from', 'to', 'label', 'polarity']);
    const id = requireSafeId(source.id, 'FIGURE_WORKSPACE_VALUE_INVALID');
    if (draft.mechanismChain.edges.some(edge => edge.id === id)) {
      throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
    }
    const from = safeId(source.from, 80);
    const to = safeId(source.to, 80);
    if (!from || !to) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const polarity = requireMechanismPolarity(source.polarity);
    if (Object.hasOwn(source, 'panelEvidence') && !Array.isArray(source.panelEvidence)) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const evidenceInputs = cappedArrayValues(source.panelEvidence, MAX_PANEL_IDS_PER_BLOCK);
    const candidate = {
      id,
      from,
      to,
      label: reviewedValue(source.label, now),
      polarity,
      panelEvidence: evidenceInputs.map(item => reviewedPanelEvidenceReference(
        draft, item, now
      )),
      humanReviewed: true,
      editedAt: boundedTimestamp(now)
    };
    validateMechanismEdgeSemantics(draft, candidate);
    draft.mechanismChain.edges.push(candidate);
    clearMechanismEdgeTombstone(draft.mechanismChain, candidate);
    candidate.panelEvidence.forEach(item =>
      clearMechanismEvidenceTombstone(draft.mechanismChain, candidate, item));
    draft.mechanismChain.initialized = true;
  }

  function upsertMechanismCellEvidence(draft, rawMutation, now) {
    const descriptor = ownRecord(rawMutation.edge, ['from', 'to', 'polarity']);
    requireOptionalPrimitiveStrings(descriptor, ['from', 'to', 'polarity']);
    const from = safeId(descriptor.from, 80);
    const to = safeId(descriptor.to, 80);
    if (!from || !to) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const polarity = requireMechanismPolarity(descriptor.polarity);
    if (typeof rawMutation.edgeId !== 'string' ||
        Array.from(rawMutation.edgeId).length > 80) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const edgeId = safeId(rawMutation.edgeId, 80);
    if (!edgeId) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');

    const evidenceInput = ownRecord(rawMutation.evidence, [
      'figureId', 'panelId', 'evidenceClass'
    ]);
    requireOptionalPrimitiveStrings(evidenceInput, [
      'figureId', 'panelId', 'evidenceClass'
    ]);
    const evidenceClass = explicitMechanismEvidenceClass(
      evidenceInput.evidenceClass
    );
    if (!evidenceClass) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const evidence = reviewedPanelEvidenceReference(draft, {
      ...evidenceInput,
      evidenceClass,
      evidenceClassSource: 'manual'
    }, now);

    let edge = draft.mechanismChain.edges.find(item => item.id === edgeId);
    if (edge && (edge.from !== from || edge.to !== to)) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    if (!edge) {
      edge = draft.mechanismChain.edges.find(item =>
        item.from === from && item.to === to
      );
    }
    if (!edge) {
      addMechanismEdge(draft, {
        id: edgeId, from, to, label: '', polarity, panelEvidence: []
      }, now);
      edge = requireMechanismItem(draft.mechanismChain.edges, edgeId);
    }
    if (edge.panelEvidence.some(item =>
      item.figureId === evidence.figureId && item.panelId === evidence.panelId
    )) {
      clearMechanismEvidenceTombstone(draft.mechanismChain, edge, evidence);
      return;
    }
    if (edge.panelEvidence.length >= MAX_PANEL_IDS_PER_BLOCK) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    edge.panelEvidence.push(evidence);
    clearMechanismEvidenceTombstone(draft.mechanismChain, edge, evidence);
    draft.mechanismChain.initialized = true;
  }

  function addMechanismBranch(draft, rawNode, rawEdge, now) {
    const previousChain = normalizeMechanismChain(
      draft.mechanismChain, draft.figures
    );
    try {
      addMechanismNode(draft, rawNode, now);
      addMechanismEdge(draft, rawEdge, now);
    } catch (error) {
      draft.mechanismChain = previousChain;
      throw error;
    }
  }

  function applyMechanismReviewTombstones(existingValue, generatedValue) {
    const tombstones = normalizeMechanismReviewTombstones(
      existingValue?.reviewTombstones
    );
    const removedNodeIds = new Set(tombstones.nodes.map(item => item.id));
    const nodes = generatedValue.nodes.filter(node => !removedNodeIds.has(node.id));
    const nodeIds = new Set(nodes.map(node => node.id));
    const candidateEdges = generatedValue.edges.filter(edge =>
      nodeIds.has(edge.from) && nodeIds.has(edge.to));
    const edgesByEndpoints = new Map();
    for (const edge of candidateEdges) {
      const key = `${edge.from}\u0000${edge.to}`;
      if (!edgesByEndpoints.has(key)) edgesByEndpoints.set(key, []);
      edgesByEndpoints.get(key).push(edge);
    }
    const exactRemovedEdges = new Set();
    const fallbackRemovedEdges = new Set();
    const edgeTombstonesByEndpoints = new Map();
    for (const item of tombstones.edges) {
      const endpointKey = `${item.from}\u0000${item.to}`;
      if (!edgeTombstonesByEndpoints.has(endpointKey)) {
        edgeTombstonesByEndpoints.set(endpointKey, []);
      }
      edgeTombstonesByEndpoints.get(endpointKey).push(item);
      const exact = (edgesByEndpoints.get(endpointKey) || [])
        .find(edge => edge.id === item.id);
      if (exact) exactRemovedEdges.add(exact);
    }
    for (const [endpointKey, items] of edgeTombstonesByEndpoints) {
      const unmatched = items.filter(item => !(edgesByEndpoints.get(endpointKey) || [])
        .some(edge => edge.id === item.id));
      if (!unmatched.length) continue;
      const candidates = (edgesByEndpoints.get(endpointKey) || [])
        .filter(edge => !exactRemovedEdges.has(edge));
      if (!candidates.length) continue;
      if (unmatched.length !== 1 || candidates.length !== 1) {
        throw workspaceError('FIGURE_WORKSPACE_REVIEW_MERGE_AMBIGUOUS');
      }
      fallbackRemovedEdges.add(candidates[0]);
    }
    const survivingEdges = candidateEdges.filter(edge =>
      !exactRemovedEdges.has(edge) && !fallbackRemovedEdges.has(edge));
    const removedPanelsByEdge = new Map();
    const evidenceTombstonesByEndpoints = new Map();
    for (const item of tombstones.evidence) {
      const endpointKey = `${item.from}\u0000${item.to}`;
      if (!evidenceTombstonesByEndpoints.has(endpointKey)) {
        evidenceTombstonesByEndpoints.set(endpointKey, []);
      }
      evidenceTombstonesByEndpoints.get(endpointKey).push(item);
    }
    const markRemovedEvidence = (edge, item) => {
      if (!removedPanelsByEdge.has(edge)) removedPanelsByEdge.set(edge, new Set());
      removedPanelsByEdge.get(edge).add(`${item.figureId}\u0000${item.panelId}`);
    };
    for (const [endpointKey, items] of evidenceTombstonesByEndpoints) {
      const candidates = survivingEdges.filter(edge =>
        `${edge.from}\u0000${edge.to}` === endpointKey);
      const unmatched = [];
      for (const item of items) {
        const exact = candidates.find(edge => edge.id === item.edgeId);
        if (exact) markRemovedEvidence(exact, item);
        else unmatched.push(item);
      }
      if (!unmatched.length || !candidates.length) continue;
      const oldEdgeIds = new Set(unmatched.map(item => item.edgeId));
      if (oldEdgeIds.size !== 1 || candidates.length !== 1) {
        throw workspaceError('FIGURE_WORKSPACE_REVIEW_MERGE_AMBIGUOUS');
      }
      unmatched.forEach(item => markRemovedEvidence(candidates[0], item));
    }
    const edges = survivingEdges.map(edge => ({
      ...edge,
      panelEvidence: edge.panelEvidence.filter(item =>
        !removedPanelsByEdge.get(edge)?.has(`${item.figureId}\u0000${item.panelId}`)
      )
    }));
    const layoutPreferences = normalizeMechanismLayoutPreferences(
      generatedValue.layoutPreferences, nodes.map(node => node.id)
    );
    const result = {
      ...generatedValue,
      nodes,
      edges,
      reviewTombstones: tombstones
    };
    if (hasMechanismLayoutPreferences(layoutPreferences)) {
      result.layoutPreferences = layoutPreferences;
    } else {
      delete result.layoutPreferences;
    }
    return result;
  }

  function mergeReviewedMechanismChain(existingValue, generatedValue) {
    const existing = existingValue || { nodes: [], edges: [] };
    const generated = applyMechanismReviewTombstones(
      existing, generatedValue || { nodes: [], edges: [] }
    );
    const removedNodeIds = new Set(
      generated.reviewTombstones.nodes.map(item => item.id)
    );
    const existingNodes = new Map((existing.nodes || []).map(node => [node.id, node]));
    const nodes = generated.nodes.map(node => {
      const prior = existingNodes.get(node.id);
      return prior?.label?.humanReviewed === true
        ? { ...node, label: prior.label }
        : node;
    });
    const generatedNodeIds = new Set(nodes.map(node => node.id));
    for (const node of existing.nodes || []) {
      if (generatedNodeIds.has(node.id) || removedNodeIds.has(node.id) ||
          node.label?.humanReviewed !== true) continue;
      if (nodes.length >= MAX_COLLECTION_ITEMS) {
        throw workspaceError('FIGURE_WORKSPACE_REVIEW_MERGE_CAPACITY');
      }
      nodes.push(node);
      generatedNodeIds.add(node.id);
    }
    const existingEdges = new Map((existing.edges || []).map(edge => [edge.id, edge]));
    const isReviewedEdge = edge => edge?.humanReviewed === true ||
      edge?.label?.humanReviewed === true ||
      (edge?.panelEvidence || []).some(item =>
        item.humanReviewed === true || item.evidenceClassSource === 'manual'
      );
    for (const edge of generated.edges) {
      const prior = existingEdges.get(edge.id);
      if (prior && (prior.from !== edge.from || prior.to !== edge.to) &&
          isReviewedEdge(prior)) {
        throw workspaceError('FIGURE_WORKSPACE_REVIEW_MERGE_ID_CONFLICT');
      }
    }
    const existingEdgesByEndpoints = new Map();
    for (const edge of existing.edges || []) {
      const key = `${edge.from}\u0000${edge.to}`;
      if (!existingEdgesByEndpoints.has(key)) existingEdgesByEndpoints.set(key, []);
      existingEdgesByEndpoints.get(key).push(edge);
    }
    const mergedExistingEdgeIds = new Set();
    const edges = generated.edges.map(edge => {
      let prior = existingEdges.get(edge.id);
      if (!prior || prior.from !== edge.from || prior.to !== edge.to ||
          mergedExistingEdgeIds.has(prior.id)) {
        const candidates = (existingEdgesByEndpoints.get(
          `${edge.from}\u0000${edge.to}`
        ) || []).filter(item => !mergedExistingEdgeIds.has(item.id));
        prior = candidates.length === 1 ? candidates[0] : null;
      }
      if (!prior) return edge;
      mergedExistingEdgeIds.add(prior.id);
      const reviewedByPanelKey = new Map((prior.panelEvidence || [])
        .filter(item => item.humanReviewed === true || item.evidenceClassSource === 'manual')
        .map(item => [`${item.figureId}\u0000${item.panelId}`, item]));
      const panelEvidence = edge.panelEvidence.map(item => {
        const key = `${item.figureId}\u0000${item.panelId}`;
        const reviewed = reviewedByPanelKey.get(key);
        reviewedByPanelKey.delete(key);
        return reviewed || item;
      });
      for (const reviewed of reviewedByPanelKey.values()) {
        if (panelEvidence.length >= MAX_PANEL_IDS_PER_BLOCK) {
          throw workspaceError('FIGURE_WORKSPACE_REVIEW_MERGE_CAPACITY');
        }
        panelEvidence.push(reviewed);
      }
      return {
        ...edge,
        label: prior.label?.humanReviewed === true ? prior.label : edge.label,
        polarity: prior.humanReviewed === true ? prior.polarity : edge.polarity,
        panelEvidence,
        humanReviewed: prior.humanReviewed === true,
        editedAt: prior.humanReviewed === true ? prior.editedAt : edge.editedAt
      };
    });
    const generatedEdgeIds = new Set(edges.map(edge => edge.id));
    for (const edge of existing.edges || []) {
      const manuallyReviewed = isReviewedEdge(edge);
      if (!manuallyReviewed || generatedEdgeIds.has(edge.id) ||
          mergedExistingEdgeIds.has(edge.id) ||
          !generatedNodeIds.has(edge.from) || !generatedNodeIds.has(edge.to)) {
        continue;
      }
      if (exactMechanismEdgeDuplicate(edges, edge)) {
        throw workspaceError('FIGURE_WORKSPACE_REVIEW_MERGE_AMBIGUOUS');
      }
      if (edges.length >= MAX_COLLECTION_ITEMS) {
        throw workspaceError('FIGURE_WORKSPACE_REVIEW_MERGE_CAPACITY');
      }
      edges.push(edge);
      generatedEdgeIds.add(edge.id);
    }
    return { ...generated, nodes, edges };
  }

  function seedMechanismChain(draft, value, force = false, options = {}) {
    if (!force && (draft.mechanismChain.initialized === true ||
        draft.mechanismChain.nodes.length || draft.mechanismChain.edges.length)) return;
    if (!isPlainObject(value)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const source = ownRecord(value, CHAIN_KEYS);
    // Model generation owns nodes and edges only. Panel aliases are reviewed
    // workspace state and may never be imported from a generated payload.
    const panelAliases = normalizeMechanismPanelAliases(
      draft.mechanismChain.panelAliases, draft.figures
    );
    if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const nodes = [];
    const nodeIds = new Set();
    for (const rawNode of cappedArrayValues(source.nodes, MAX_COLLECTION_ITEMS)) {
      if (!isPlainObject(rawNode)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      const node = ownRecord(rawNode, NODE_KEYS);
      requireOptionalPrimitiveStrings(node, NODE_KEYS);
      const id = requireSafeId(node.id, 'FIGURE_WORKSPACE_VALUE_INVALID');
      if (nodeIds.has(id)) throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
      nodeIds.add(id);
      nodes.push({ id, label: editableValue(boundedText(node.label), false, 0) });
    }
    const edges = [];
    const edgeIds = new Set();
    for (const rawEdge of cappedArrayValues(source.edges, MAX_COLLECTION_ITEMS)) {
      if (!isPlainObject(rawEdge)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      const edge = ownRecord(rawEdge, EDGE_KEYS);
      requireOptionalPrimitiveStrings(edge, ['id', 'from', 'to', 'label', 'polarity']);
      const id = requireSafeId(edge.id, 'FIGURE_WORKSPACE_VALUE_INVALID');
      const from = safeId(edge.from, 80);
      const to = safeId(edge.to, 80);
      if (edgeIds.has(id)) throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
      if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) {
        throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
      }
      if (Object.hasOwn(edge, 'panelEvidence') && !Array.isArray(edge.panelEvidence)) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
      const polarity = requireMechanismPolarity(edge.polarity);
      const candidate = {
        id,
        from,
        to,
        label: editableValue(boundedText(edge.label), false, 0),
        polarity,
        panelEvidence: cappedArrayValues(
          edge.panelEvidence, MAX_PANEL_IDS_PER_BLOCK
        ).map(item => ({
          ...resolvePanelEvidenceReference(draft, item),
          humanReviewed: false,
          editedAt: 0
        })),
        humanReviewed: false,
        editedAt: 0
      };
      if (from === to && polarity === 'neutral') {
        throw workspaceError('FIGURE_WORKSPACE_MECHANISM_SELF_LOOP_POLARITY_REQUIRED');
      }
      if (options.allowParallelGeneratedRelations !== true &&
          exactMechanismEdgeDuplicate(edges, candidate)) {
        throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
      }
      edgeIds.add(id);
      edges.push(candidate);
    }
    const generationIssues = normalizeMechanismGenerationIssues(source.generationIssues);
    const layoutPreferences = normalizeMechanismLayoutPreferences(
      source.layoutPreferences, nodes.map(node => node.id)
    );
    const generatedChain = {
      initialized: true, nodes, edges, panelAliases,
      reviewTombstones: emptyMechanismReviewTombstones(),
      ...(hasMechanismLayoutPreferences(layoutPreferences) ? { layoutPreferences } : {}),
      ...(generationIssues.length ? { generationIssues } : {})
    };
    draft.mechanismChain = force
      ? mergeReviewedMechanismChain(draft.mechanismChain, generatedChain)
      : generatedChain;
  }

  function importReviewedMechanismChain(draft, value) {
    if (!isPlainObject(value)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const source = ownRecord(value, CHAIN_KEYS);
    if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const rawNodes = cappedArrayValues(source.nodes, MAX_COLLECTION_ITEMS);
    const rawEdges = cappedArrayValues(source.edges, MAX_COLLECTION_ITEMS);
    const canonicalEditable = raw => {
      if (!isPlainObject(raw)) return false;
      const editable = ownRecord(raw, ['value', 'humanReviewed', 'editedAt']);
      return typeof editable.value === 'string' &&
        typeof editable.humanReviewed === 'boolean' &&
        Number.isSafeInteger(editable.editedAt) && editable.editedAt >= 0;
    };
    for (const rawNode of rawNodes) {
      const node = ownRecord(rawNode, NODE_KEYS);
      if (typeof node.id !== 'string' || !canonicalEditable(node.label)) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
    }
    for (const rawEdge of rawEdges) {
      const edge = ownRecord(rawEdge, EDGE_KEYS);
      if (typeof edge.id !== 'string' || typeof edge.from !== 'string' ||
          typeof edge.to !== 'string' || typeof edge.polarity !== 'string' ||
          !canonicalEditable(edge.label) || !Array.isArray(edge.panelEvidence)) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
      if ((Object.hasOwn(edge, 'humanReviewed') &&
          typeof edge.humanReviewed !== 'boolean') ||
          (Object.hasOwn(edge, 'editedAt') &&
          (!Number.isSafeInteger(edge.editedAt) || edge.editedAt < 0 ||
            edge.editedAt > MAX_TIMESTAMP))) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
    }
    const imported = normalizeMechanismChain(value, draft.figures);
    if (imported.nodes.length !== rawNodes.length ||
        imported.edges.length !== rawEdges.length) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const nodeIds = new Set(imported.nodes.map(node => node.id));
    const signatures = new Set();
    for (const edge of imported.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) ||
          (edge.from === edge.to && edge.polarity === 'neutral')) {
        throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
      }
      const signature = `${edge.from}\u0000${edge.to}\u0000${edge.polarity}` +
        `\u0000${edge.label.value}`;
      if (signatures.has(signature)) {
        throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
      }
      signatures.add(signature);
    }
    draft.mechanismChain = imported;
  }

  function strictImportMapEntries(value, maximum) {
    if (!value || typeof value !== 'object') return null;
    let prototype;
    let keys;
    try {
      if (Array.isArray(value)) return null;
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch (_) { return null; }
    if ((prototype !== Object.prototype && prototype !== null) ||
        keys.length > maximum || keys.some(key => typeof key !== 'string' ||
          BLOCKED_PROPERTY_NAMES.has(key.toLowerCase()))) return null;
    const entries = [];
    for (const key of keys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { return null; }
      if (!descriptor || descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) return null;
      entries.push([key, descriptor.value]);
    }
    return entries;
  }

  function strictImportOwnDataShape(value, allowedKeys) {
    if (!value || typeof value !== 'object') return false;
    let keys;
    try {
      if (Array.isArray(value)) return false;
      keys = Reflect.ownKeys(value);
    } catch (_) { return false; }
    const allowed = new Set(allowedKeys);
    for (const key of keys) {
      if (typeof key !== 'string' || !allowed.has(key)) return false;
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { return false; }
      if (!descriptor || descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  }

  function strictImportCanonicalEqual(value, canonical, depth = 0, seen = new WeakSet()) {
    if (Object.is(value, canonical)) return true;
    if (depth > 16 || !value || !canonical || typeof value !== 'object' ||
        typeof canonical !== 'object' || seen.has(value)) return false;
    let valueIsArray;
    let canonicalIsArray;
    let keys;
    try {
      valueIsArray = Array.isArray(value);
      canonicalIsArray = Array.isArray(canonical);
      keys = Reflect.ownKeys(value);
    } catch (_) { return false; }
    if (valueIsArray !== canonicalIsArray) return false;
    seen.add(value);
    if (valueIsArray) {
      const rows = strictGeneratedArray(value, canonical.length);
      const expectedKeys = new Set([
        'length', ...canonical.map((_, index) => String(index))
      ]);
      if (!rows || rows.length !== canonical.length || keys.length !== expectedKeys.size ||
          keys.some(key => typeof key !== 'string' || !expectedKeys.has(key))) return false;
      for (const key of keys) {
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
        catch (_) { return false; }
        if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
            (key !== 'length' && descriptor.enumerable !== true)) return false;
      }
      for (let index = 0; index < rows.length; index += 1) {
        if (!strictImportCanonicalEqual(rows[index], canonical[index], depth + 1, seen)) {
          return false;
        }
      }
      seen.delete(value);
      return true;
    }
    let canonicalKeys;
    try { canonicalKeys = Reflect.ownKeys(canonical); } catch (_) { return false; }
    const expectedKeys = new Set(canonicalKeys);
    if (keys.length !== canonicalKeys.length ||
        keys.some(key => typeof key !== 'string' || !expectedKeys.has(key))) return false;
    for (const key of keys) {
      let descriptor;
      let canonicalDescriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
        canonicalDescriptor = Object.getOwnPropertyDescriptor(canonical, key);
      } catch (_) { return false; }
      if (!descriptor || descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value') || !canonicalDescriptor ||
          !Object.hasOwn(canonicalDescriptor, 'value') ||
          !strictImportCanonicalEqual(
            descriptor.value, canonicalDescriptor.value, depth + 1, seen
          )) return false;
    }
    seen.delete(value);
    return true;
  }

  function strictImportedReviewTombstones(value) {
    if (typeof value === 'undefined') return true;
    const source = strictOwnDataRecord(value, ['nodes', 'edges', 'evidence']);
    if (!source || !strictImportOwnDataShape(value, REVIEW_TOMBSTONE_KEYS)) return false;
    const schemas = [
      ['nodes', MAX_COLLECTION_ITEMS, NODE_TOMBSTONE_KEYS, item => {
        const row = strictOwnDataRecord(item, ['id', 'editedAt']);
        return row && safeId(row.id, 80) === row.id &&
          strictAuditTimestamp(row.editedAt) ? row.id : '';
      }],
      ['edges', MAX_COLLECTION_ITEMS, EDGE_TOMBSTONE_KEYS, item => {
        const row = strictOwnDataRecord(item, ['id', 'from', 'to', 'editedAt']);
        return row && safeId(row.id, 80) === row.id &&
          safeId(row.from, 80) === row.from && safeId(row.to, 80) === row.to &&
          strictAuditTimestamp(row.editedAt)
          ? JSON.stringify([row.id, row.from, row.to]) : '';
      }],
      ['evidence', 512, EVIDENCE_TOMBSTONE_KEYS, item => {
        const row = strictOwnDataRecord(item, [
          'edgeId', 'from', 'to', 'figureId', 'panelId', 'editedAt'
        ]);
        return row && safeId(row.edgeId, 80) === row.edgeId &&
          safeId(row.from, 80) === row.from && safeId(row.to, 80) === row.to &&
          safeId(row.figureId) === row.figureId && safePanelId(row.panelId) === row.panelId &&
          strictAuditTimestamp(row.editedAt)
          ? JSON.stringify([row.edgeId, row.from, row.to, row.figureId, row.panelId]) : '';
      }]
    ];
    for (const [field, maximum, keys, identity] of schemas) {
      const rows = strictGeneratedArray(source[field], maximum);
      if (!rows) return false;
      const seen = new Set();
      for (const item of rows) {
        const key = identity(item);
        if (!key || seen.has(key) || !strictAuditCloneable(item, keys)) return false;
        seen.add(key);
      }
      if (!strictAuditCloneableArray(source[field], rows.length)) return false;
    }
    return true;
  }

  function strictImportedLayoutPreferences(value, nodeIds) {
    if (typeof value === 'undefined') return true;
    const source = strictOwnDataRecord(value, [], [
      'pinnedRanks', 'siblingOrder', 'collapsedGroups'
    ]);
    if (!source || !strictImportOwnDataShape(value, [
      'pinnedRanks', 'siblingOrder', 'collapsedGroups'
    ])) return false;
    for (const field of ['pinnedRanks', 'siblingOrder']) {
      if (!Object.hasOwn(source, field)) continue;
      const entries = strictImportMapEntries(source[field], MAX_COLLECTION_ITEMS);
      if (!entries || entries.some(([id, rank]) =>
        safeId(id, 80) !== id || !nodeIds.has(id) ||
        !Number.isSafeInteger(rank) || rank < 0 || rank >= 64)) return false;
    }
    if (Object.hasOwn(source, 'collapsedGroups')) {
      const groups = strictGeneratedArray(source.collapsedGroups, 16);
      const seen = new Set();
      if (!groups || groups.some(id => typeof id !== 'string' ||
          safeId(id, 80) !== id || seen.has(id) || !seen.add(id)) ||
          !strictAuditCloneableArray(source.collapsedGroups, groups.length)) return false;
    }
    return true;
  }

  function strictImportedGenerationIssues(value) {
    if (typeof value === 'undefined') return true;
    const rows = strictGeneratedArray(value, 16);
    if (!rows) return false;
    const valid = rows.every(item => {
      const issue = strictOwnDataRecord(item, [
        'code', 'message', 'edgeIndex', 'edgeId', 'displayId'
      ]);
      return Boolean(issue && strictAuditText(issue.code, 80, false) &&
        strictAuditText(issue.message, 240, false) &&
        Number.isSafeInteger(issue.edgeIndex) && issue.edgeIndex >= -1 &&
        issue.edgeIndex < MAX_COLLECTION_ITEMS &&
        safeId(issue.edgeId, 80) === issue.edgeId &&
        mechanismPanelReference(issue.displayId) === issue.displayId &&
        strictAuditCloneable(item, GENERATION_ISSUE_KEYS));
    });
    return valid && strictAuditCloneableArray(value, rows.length);
  }

  function strictImportedMechanismChain(draft, value) {
    const source = strictOwnDataRecord(value, [
      'nodes', 'edges', 'panelAliases', 'reviewTombstones'
    ], CHAIN_KEYS.filter(key => ![
      'nodes', 'edges', 'panelAliases', 'reviewTombstones'
    ].includes(key)));
    if (!source || !strictImportOwnDataShape(value, CHAIN_KEYS) ||
        (Object.hasOwn(source, 'initialized') && source.initialized !== true)) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const rawNodes = strictGeneratedArray(source.nodes, MAX_COLLECTION_ITEMS);
    const rawEdges = strictGeneratedArray(source.edges, MAX_COLLECTION_ITEMS);
    if (!rawNodes || !rawEdges ||
        rawNodes.some(node => !strictGeneratedAuditNode(node)) ||
        rawEdges.some(edge => !strictAuditEdge(edge, true, false))) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    if ((rawNodes.length || rawEdges.length) && source.initialized !== true) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    if (!strictAuditCloneableArray(source.nodes, rawNodes.length) ||
        !strictAuditCloneableArray(source.edges, rawEdges.length)) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const nodeIds = new Set();
    for (const rawNode of rawNodes) {
      const node = strictOwnDataRecord(rawNode, ['id']);
      if (!node || nodeIds.has(node.id)) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
      nodeIds.add(node.id);
    }
    const edgeIds = new Set();
    const duplicateSignatures = new Map();
    if (Object.hasOwn(source, 'drawing')) {
      if (!canvasContracts) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      canvasContracts.readMechanismDrawing(source.drawing, { chain: source, figures: draft.figures });
    }
    for (const rawEdge of rawEdges) {
      const edge = strictOwnDataRecord(rawEdge, [
        'id', 'from', 'to', 'label', 'polarity', 'panelEvidence',
        'humanReviewed', 'editedAt'
      ]);
      if (!edge || edgeIds.has(edge.id) || !nodeIds.has(edge.from) ||
          !nodeIds.has(edge.to) || (edge.from === edge.to && edge.polarity === 'neutral')) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
      edgeIds.add(edge.id);
      const label = strictAuditEditable(edge.label);
      const signature = JSON.stringify([edge.from, edge.to, edge.polarity, label.value,
        source.drawing?.edgeContexts?.[edge.id] || {}]);
      const ids = duplicateSignatures.get(signature) || [];
      ids.push(edge.id);
      duplicateSignatures.set(signature, ids);
      const evidenceRows = strictGeneratedArray(edge.panelEvidence, MAX_PANEL_IDS_PER_BLOCK);
      for (const rawEvidence of evidenceRows) {
        const evidence = strictAuditPanelEvidence(rawEvidence, true);
        if (!evidence || (evidence.evidenceClassSource && !evidence.evidenceClass)) {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        if (evidence.unresolved) {
          continue;
        }
        const identity = resolvePanelKey(
          draft.figures, `${evidence.figureId}:${evidence.panelId}`
        );
        const panel = identity && draft.figures[identity.figureId].panels[identity.panelId];
        if (!identity || evidence.value !== panel.compactId) {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
      }
    }
    if (Object.hasOwn(source, 'panelAliases')) {
      const aliases = strictImportMapEntries(source.panelAliases, 512);
      if (!aliases || aliases.some(([key, alias]) =>
        !resolvePanelKey(draft.figures, key) || !strictAuditEditable(alias))) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
    }
    if (!strictImportedReviewTombstones(source.reviewTombstones) ||
        !strictImportedLayoutPreferences(source.layoutPreferences, nodeIds) ||
        !strictImportedGenerationIssues(source.generationIssues)) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const normalized = normalizeMechanismChain(value, draft.figures);
    if (normalized.nodes.length !== rawNodes.length ||
        normalized.edges.length !== rawEdges.length ||
        !strictImportCanonicalEqual(value, normalized)) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    return { chain: normalized, duplicateSignatures };
  }

  function generatedPreviewPanelsMatchInventory(draft, preview) {
    const keys = [];
    const sourceRefs = [];
    for (const claim of preview.claims || []) {
      keys.push(claim.panelKey);
      sourceRefs.push(...(claim.sourceRefs || []));
    }
    for (const relation of preview.relations || []) {
      for (const assignment of relation.assignments || []) {
        keys.push(assignment.panelKey);
        sourceRefs.push(...(assignment.sourceRefs || []));
      }
    }
    for (const usage of preview.claimUsages || []) keys.push(usage.panelKey);
    for (const unresolved of preview.unresolvedClaims || []) keys.push(unresolved.panelKey);
    for (const disposition of preview.panelDispositions || []) keys.push(disposition.panelKey);
    return keys.every(key => Boolean(resolvePanelKey(draft.figures, key))) &&
      sourceRefs.every(sourceRef => {
        const parsed = parseGeneratedSourceHandle(sourceRef);
        return Boolean(parsed && resolvePanelKey(draft.figures, parsed.panelKey));
      });
  }

  function importMechanismWorkspace(draft, mutation) {
    if (mutation.mechanismGeneration !== null &&
        typeof mutation.mechanismGeneration !== 'string') {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const validated = strictImportedMechanismChain(draft, mutation.chain);
    let generation = null;
    if (mutation.mechanismGeneration !== null) {
      generation = normalizeMechanismGeneration(mutation.mechanismGeneration);
      const identity = generation?.identity;
      if (!generation || !identity || !draft.binding ||
          identity.documentId !== draft.binding.documentId ||
          identity.workspaceId !== draft.binding.workspaceId ||
          identity.workspaceGeneration !== draft.binding.workspaceGeneration ||
          !generatedPreviewPanelsMatchInventory(draft, generation.preview)) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
      const auditedChain = strictGeneratedAuditChain(
        mutation.chain, generation.preview
      );
      if (!auditedChain ||
          !normalizedChainMatchesGeneration(auditedChain, generation.preview)) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
    }
    const auditedRelationIds = new Set(generation
      ? generation.preview.relations.filter(relation => relation.renderable === true)
        .map(relation => relation.relationId)
      : []);
    for (const ids of validated.duplicateSignatures.values()) {
      if (ids.length > 1 && ids.some(id => !auditedRelationIds.has(id))) {
        throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      }
    }
    draft.mechanismChain = validated.chain;
    if (generation) {
      draft.revision = Math.max(
        draft.revision, generation.committedWorkspaceRevision
      );
      draft.mechanismGeneration = mutation.mechanismGeneration;
    } else {
      delete draft.mechanismGeneration;
    }
  }

  function prepareMechanismWorkspaceImport(current, mutation, grantCapability) {
    const next = normalizeFigureWorkspaceDraftForImport(current);
    importMechanismWorkspace(next, mutation);
    if (aggregateDraftTextCharacters(next) > FIGURE_WORKSPACE_TEXT_BUDGET ||
        serializedDraftLength(next) > FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS) {
      throw workspaceError('FIGURE_WORKSPACE_BUDGET_EXCEEDED');
    }
    const normalized = normalizeFigureWorkspaceDraftForImport(next);
    if (importedWorkspaceFingerprint(normalized) ===
        importedWorkspaceFingerprint(current)) return current;
    if (current.revision >= MAX_REVISION) {
      throw workspaceError('FIGURE_WORKSPACE_REVISION_LIMIT');
    }
    normalized.revision = Math.max(current.revision + 1, normalized.revision);
    if (grantCapability === true) TRUSTED_FIGURE_WORKSPACE_DRAFTS.add(normalized);
    return normalized;
  }

  function validateMechanismWorkspaceImport(value, chain, mechanismGeneration) {
    const current = normalizeFigureWorkspaceDraftForImport(value);
    prepareMechanismWorkspaceImport(
      current, { chain, mechanismGeneration }, false
    );
    return true;
  }

  function resolvePanelEvidenceReference(draft, value) {
    if (!isPlainObject(value)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const reference = ownRecord(value, [
      'figureId', 'panelId', 'evidenceClass', 'evidenceClassSource'
    ]);
    requireOptionalPrimitiveStrings(reference, [
      'figureId', 'panelId', 'evidenceClass', 'evidenceClassSource'
    ]);
    const figure = requireFigure(draft, reference.figureId);
    const panelId = safePanelId(reference.panelId);
    if (!panelId || !Object.hasOwn(figure.panels, panelId)) {
      throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
    }
    const suppliedEvidenceClass = Object.hasOwn(reference, 'evidenceClass');
    const evidenceClass = explicitMechanismEvidenceClass(reference.evidenceClass);
    if (suppliedEvidenceClass && !evidenceClass) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    const suppliedEvidenceClassSource = Object.hasOwn(reference, 'evidenceClassSource');
    const evidenceClassSource = explicitMechanismEvidenceClassSource(
      reference.evidenceClassSource
    );
    if (suppliedEvidenceClassSource && !evidenceClassSource) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    if (evidenceClassSource && !evidenceClass) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    return {
      figureId: figure.figureId,
      panelId,
      value: mechanismCompactPanelId(figure, figure.figureLabel, panelId),
      unresolved: false,
      ...(evidenceClass ? { evidenceClass } : {}),
      ...(evidenceClassSource ? { evidenceClassSource } : {})
    };
  }

  function reviewedPanelEvidenceReference(draft, value, now) {
    const reference = resolvePanelEvidenceReference(draft, value);
    return {
      ...reference,
      humanReviewed: true,
      editedAt: boundedTimestamp(now)
    };
  }

  function mutateReviewedCollection(draft, mutation, now, kind) {
    const collections = {
      background: ['backgroundItems', 'background_item'],
      question: ['scientificQuestions', 'scientific_question'],
      innovation: ['innovationPoints', 'innovation_point'],
      limitation: ['limitationPoints', 'limitation_point']
    };
    const [collectionKey, prefix] = collections[kind] || [];
    const items = draft.meta[collectionKey];
    if (kind === 'question') {
      if (mutation.type === `add_${prefix}`) {
        if (items.length >= MAX_COLLECTION_ITEMS) {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        items.push(reviewedScientificQuestion(
          mutation.value, null, now, `question-${items.length + 1}`
        ));
      } else if (mutation.type === `update_${prefix}`) {
        const index = requireCollectionIndex(mutation.index, items.length);
        items[index] = reviewedScientificQuestion(
          mutation.value, items[index], now, items[index].questionId
        );
      } else {
        items.splice(requireCollectionIndex(mutation.index, items.length), 1);
      }
      return;
    }
    if (mutation.type === `add_${prefix}`) {
      if (items.length >= MAX_COLLECTION_ITEMS) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      items.push(reviewedValue(mutation.value, now));
    } else if (mutation.type === `update_${prefix}`) {
      items[requireCollectionIndex(mutation.index, items.length)] = reviewedValue(mutation.value, now);
    } else {
      items.splice(requireCollectionIndex(mutation.index, items.length), 1);
    }
  }

  function reviewedScientificQuestion(value, current, now, fallbackId) {
    const source = isPlainObject(value) ? ownRecord(value, SCIENTIFIC_QUESTION_KEYS) : {};
    const rawText = isPlainObject(value)
      ? (Object.hasOwn(source, 'text') ? source.text : source.value)
      : value;
    const relationToken = typeof source.relationType === 'string'
      ? source.relationType.normalize('NFKC').trim().toLowerCase() : '';
    return {
      questionId: safeId(source.questionId, 100) || current?.questionId || fallbackId,
      text: boundedText(rawText),
      value: boundedText(rawText),
      relationType: SCIENTIFIC_QUESTION_RELATIONS.has(relationToken)
        ? relationToken : (current?.relationType || 'root'),
      parentQuestionIds: Array.isArray(source.parentQuestionIds)
        ? cappedArrayValues(source.parentQuestionIds, 12)
        : (current?.parentQuestionIds || []),
      supportingFigureIds: Array.isArray(source.supportingFigureIds)
        ? cappedArrayValues(source.supportingFigureIds, MAX_FIGURES)
        : (current?.supportingFigureIds || []),
      humanReviewed: true,
      editedAt: boundedTimestamp(now)
    };
  }

  function seedGeneratedMetaCollection(items, rawValues, options = {}) {
    if (!Array.isArray(rawValues)) return items;
    const hasReaderContent = items.some(item => boundedText(item?.value));
    const hasReviewedEmpty = items.some(item =>
      item?.humanReviewed === true && !boundedText(item?.value)
    );
    if (hasReaderContent || (hasReviewedEmpty && options.overwriteReviewedEmpty !== true)) {
      return items;
    }
    const values = cappedArrayValues(rawValues, MAX_COLLECTION_ITEMS)
      .map(value => boundedText(value)).filter(Boolean);
    return values.length
      ? values.map(value => editableValue(value, false, 0)) : items;
  }

  function seedGeneratedScientificQuestions(items, rawValues, options = {}) {
    if (!Array.isArray(rawValues)) return items;
    const hasReaderContent = items.some(item => boundedText(item?.value));
    const hasReviewedEmpty = items.some(item =>
      item?.humanReviewed === true && !boundedText(item?.value)
    );
    if (hasReaderContent || (hasReviewedEmpty && options.overwriteReviewedEmpty !== true)) {
      return items;
    }
    const questions = normalizeScientificQuestionList(rawValues, false, false, false)
      .filter(item => item.value);
    return questions.length ? questions : items;
  }

  function projectResearchLogicToLegacyMeta(draft, options = {}) {
    const logic = draft.meta.researchLogic;
    const backgroundTypes = new Set([
      'background', 'known_mechanism', 'prior_evidence', 'knowledge_gap',
      'rationale', 'author_aim'
    ]);
    const backgroundItems = logic.atomicEvidence
      .filter(item => backgroundTypes.has(item.type)).map(item => item.statement);
    draft.meta.backgroundItems = seedGeneratedMetaCollection(
      draft.meta.backgroundItems, backgroundItems, options
    );
    const questions = [];
    if (logic.questionTrace.coreQuestion) {
      questions.push({
        questionId: 'Q0', text: logic.questionTrace.coreQuestion.text,
        relationType: 'root', parentQuestionIds: [], supportingFigureIds: []
      });
    }
    for (const question of logic.progression) {
      questions.push({
        questionId: question.questionId,
        text: question.text,
        relationType: 'progressive',
        parentQuestionIds: question.generatedFrom,
        supportingFigureIds: []
      });
    }
    draft.meta.scientificQuestions = seedGeneratedScientificQuestions(
      draft.meta.scientificQuestions, questions, options
    );
  }

  function seedIndependentPaperPoints(draft, rawValues, key, options = {}) {
    if (!Array.isArray(rawValues)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    const details = cappedArrayValues(rawValues, 12)
      .map((item, index) => normalizePaperMetaPoint(item, `${key}-${index + 1}`))
      .filter(Boolean);
    draft.meta.paperMetaDetails[key] = details;
    draft.meta[key] = seedGeneratedMetaCollection(
      draft.meta[key], details.map(item => item.text), options
    );
  }

  function restoreModelValue(draft, mutation) {
    if (typeof mutation.target !== 'string') {
      throw workspaceError('FIGURE_WORKSPACE_TARGET_INVALID');
    }
    const target = mutation.target;
    if (target === 'figure_field') {
      const field = requireAllowedField(mutation.field, new Set(OVERVIEW_KEYS));
      requireFigure(draft, mutation.figureId).overview[field] = editableValue(
        boundedText(mutation.modelValue), false, 0
      );
    } else if (target === 'panel_field') {
      const field = requireAllowedField(mutation.field, PANEL_SCALAR_FIELDS);
      const panel = requirePanel(draft, mutation.figureId, mutation.panelId);
      const previousValue = panel[field].value;
      panel[field] = editableValue(boundedText(mutation.modelValue), false, 0);
      if (field === 'directObservation' && previousValue !== panel[field].value &&
          panel.observationSource !== undefined) {
        // This scalar restore carries no source binding for the replacement text.
        panel.observationSource = 'inference';
      }
      if (previousValue !== panel[field].value && generatedAuditReferencesPanelField(
        draft.mechanismGeneration, mutation.figureId, mutation.panelId, field
      )) delete draft.mechanismGeneration;
    } else if (target === 'panel_list') {
      const field = requireAllowedField(mutation.field, PANEL_LIST_FIELDS);
      const panel = requirePanel(draft, mutation.figureId, mutation.panelId);
      const previousValues = editableListTextValues(panel[field]);
      panel[field] = unlockedList(mutation.modelValue || [], 16);
      if (!sameTextValues(previousValues, editableListTextValues(panel[field])) &&
          generatedAuditReferencesPanelField(
            draft.mechanismGeneration, mutation.figureId, mutation.panelId, field
          )) delete draft.mechanismGeneration;
    } else {
      throw workspaceError('FIGURE_WORKSPACE_TARGET_INVALID');
    }
  }

  function replaceGeneratedMechanismV2(draft, mutation, now) {
    const generation = parseGenerationCandidateEnvelope(mutation.generationEnvelope);
    const identity = generation?.identity;
    const preview = generation?.preview;
    const binding = draft.binding;
    const committedWorkspaceRevision = identity &&
      identity.baseWorkspaceRevision < MAX_REVISION
      ? identity.baseWorkspaceRevision + 1 : -1;
    if (!generation || !identity || !preview ||
        preview.status !== 'complete' || !binding ||
        committedWorkspaceRevision < 1 ||
        identity.baseWorkspaceRevision !== mutation.expectedRevision ||
        identity.documentId !== binding.documentId ||
        identity.workspaceId !== binding.workspaceId ||
        identity.workspaceGeneration !== binding.workspaceGeneration ||
        !validateGeneratedMechanismChain(mutation.chain, preview)) {
      throw workspaceError('FIGURE_WORKSPACE_GENERATED_MECHANISM_INVALID');
    }
    // The raw v2 chain has already been matched exactly to canonical relation
    // IDs and contextual identities. Legacy/manual seeds retain their stricter
    // endpoint + polarity + label duplicate rule.
    seedMechanismChain(draft, mutation.chain, true, {
      allowParallelGeneratedRelations: true
    });
    if (!draft.mechanismChain.nodes.length || !draft.mechanismChain.edges.length) {
      throw workspaceError('FIGURE_WORKSPACE_GENERATED_MECHANISM_INVALID');
    }
    if (!normalizedChainMatchesGeneration(draft.mechanismChain, preview)) {
      throw workspaceError('FIGURE_WORKSPACE_GENERATED_MECHANISM_INVALID');
    }
    draft.revision = committedWorkspaceRevision;
    const envelope = serializeDurableGenerationEnvelope(
      generation, committedWorkspaceRevision, now
    );
    if (!envelope) throw workspaceError('FIGURE_WORKSPACE_GENERATED_MECHANISM_INVALID');
    draft.mechanismGeneration = envelope;
  }

  function applyMutationToDraft(draft, mutation, now) {
    const previousDrawingChain = draft.mechanismChain.drawing && canvasContracts
      ? JSON.parse(JSON.stringify(draft.mechanismChain)) : null;
    const canvasPresentation = mutation.type === 'apply_mechanism_canvas_command' && canvasContracts &&
      canvasContracts.mechanismCanvasCommandIsPresentation(mutation.command, draft.mechanismChain,
        { verifiedContexts: canvasContracts.mechanismCanvasVerifiedContexts(draft) });
    switch (mutation.type) {
      case 'apply_mechanism_canvas_command': {
        if (!canvasContracts) throw workspaceError('FIGURE_WORKSPACE_CANVAS_UNAVAILABLE');
        const before = draft.mechanismChain;
        let commandChain = before;
        if (!canvasPresentation &&
            ownRecord(mutation.command, ['type']).type !== 'restore_snapshot') {
          const contexts = canvasContracts.mechanismCanvasVerifiedContexts(draft);
          if (Object.keys(contexts).length) {
            const drawing = canvasContracts.normalizeMechanismDrawing(before.drawing || {}, { chain: before, figures: draft.figures });
            commandChain = { ...before, drawing: { ...drawing, edgeContexts: { ...contexts, ...drawing.edgeContexts } } };
          }
        }
        const next = canvasContracts.applyMechanismCanvasCommand(commandChain, mutation.command,
          { figures: draft.figures, now });
        // Reuse the reviewed deletion markers, including when undo restores an
        // older snapshot. They prevent a later AI refresh from reviving deletions.
        for (const node of before.nodes) {
          if (!next.nodes.some(item => item.id === node.id)) addMechanismNodeTombstone(next, node, now);
        }
        for (const edge of before.edges) {
          const replacement = next.edges.find(item => item.id === edge.id);
          if (!replacement || replacement.from !== edge.from || replacement.to !== edge.to) {
            addMechanismEdgeTombstone(next, edge, now);
          }
          for (const reference of edge.panelEvidence) {
            if (!replacement || !replacement.panelEvidence.some(item =>
              item.figureId === reference.figureId && item.panelId === reference.panelId)) {
              addMechanismEvidenceTombstone(next, edge, reference, now);
            }
          }
        }
        next.nodes.forEach(node => clearMechanismNodeTombstone(next, node.id));
        next.edges.forEach(edge => {
          clearMechanismEdgeTombstone(next, edge);
          edge.panelEvidence.forEach(reference => clearMechanismEvidenceTombstone(next, edge, reference));
        });
        draft.mechanismChain = next;
        break;
      }
      case 'set_figure_field': {
        const field = requireAllowedField(mutation.field, new Set([...OVERVIEW_KEYS, 'displayName']));
        requireFigure(draft, mutation.figureId).overview[field] = reviewedValue(mutation.value, now);
        break;
      }
      case 'set_panel_field': {
        const field = requireAllowedField(mutation.field, new Set([...PANEL_SCALAR_FIELDS, 'displayName']));
        const panel = requirePanel(draft, mutation.figureId, mutation.panelId);
        const previousValue = panel[field]?.value;
        panel[field] = reviewedValue(mutation.value, now);
        if (previousValue !== panel[field].value && generatedAuditReferencesPanelField(
          draft.mechanismGeneration, mutation.figureId, mutation.panelId, field
        )) delete draft.mechanismGeneration;
        break;
      }
      case 'set_panel_list': {
        const field = requireAllowedField(mutation.field, PANEL_LIST_FIELDS);
        const panel = requirePanel(draft, mutation.figureId, mutation.panelId);
        const previousValues = editableListTextValues(panel[field]);
        panel[field] = reviewedList(mutation.value, now);
        if (!sameTextValues(previousValues, editableListTextValues(panel[field])) &&
            generatedAuditReferencesPanelField(
              draft.mechanismGeneration, mutation.figureId, mutation.panelId, field
            )) delete draft.mechanismGeneration;
        break;
      }
      case 'add_panel': {
        const figure = requireFigure(draft, mutation.figureId);
        const panelId = safePanelId(mutation.panelId);
        if (!panelId) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        if (Object.hasOwn(figure.panels, panelId)) throw workspaceError('FIGURE_WORKSPACE_DUPLICATE_ID');
        if (Object.keys(figure.panels).length >= MAX_PANELS_PER_FIGURE) {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        figure.panels[panelId] = emptyPanel(
          panelId, figure.figureLabel, figure.isSupplemental
        );
        break;
      }
      case 'remove_panel': {
        const figure = requireFigure(draft, mutation.figureId);
        const panelId = safePanelId(mutation.panelId);
        if (!panelId || !Object.hasOwn(figure.panels, panelId)) {
          throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
        }
        delete figure.panels[panelId];
        delete draft.mechanismChain.panelAliases[
          mechanismPanelKey(figure.figureId, panelId)
        ];
        for (const edge of draft.mechanismChain.edges) {
          edge.panelEvidence = edge.panelEvidence.filter(item =>
            item.figureId !== figure.figureId || item.panelId !== panelId
          );
        }
        break;
      }
      case 'add_evidence_block':
        addEvidenceBlock(draft, mutation.block, now, mutation.figureId);
        break;
      case 'add_manual_evidence_block':
      case 'update_manual_evidence_block':
        mutateManualEvidenceBlock(draft, mutation, now);
        break;
      case 'split_manual_evidence_block':
        splitManualEvidenceBlock(draft, mutation, now);
        break;
      case 'merge_manual_evidence_blocks':
        mergeManualEvidenceBlocks(draft, mutation, now);
        break;
      case 'update_evidence_block': {
        const block = requireEvidenceBlock(draft, mutation.blockId, mutation.figureId);
        if (mutation.field === 'panelIds') {
          if (!Array.isArray(mutation.value)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
          const source = manualEvidenceBlockSource({ panelIds: mutation.value }, true);
          if (mutation.figureId) ensureManualEvidencePanels(requireFigure(draft, mutation.figureId), source.panelIds, mutation.createMissingPanels);
          const figure = mutation.figureId ? requireFigure(draft, mutation.figureId) : null;
          recordReplacedEvidenceBlock(figure, block);
          promoteManualEvidenceBlock(block, figure, now);
          block.panelIds = source.panelIds;
        } else {
          const field = requireAllowedField(mutation.field, new Set([
            ...EVIDENCE_SCALAR_FIELDS, 'displayName',
            ...(block.provenance === 'manual' ? MANUAL_EVIDENCE_FIELDS : [])
          ]));
          block[field] = reviewedValue(mutation.value, now);
        }
        break;
      }
      case 'set_transition_text':
        requireEvidenceBlock(draft, mutation.blockId, mutation.figureId).transitionToNext =
          reviewedValue(mutation.value, now);
        break;
      case 'remove_evidence_block': {
        const blocks = evidenceBlockCollection(draft, mutation.figureId);
        const block = requireEvidenceBlock(draft, mutation.blockId, mutation.figureId);
        if (mutation.figureId) recordReplacedEvidenceBlock(requireFigure(draft, mutation.figureId), block);
        blocks.splice(blocks.indexOf(block), 1);
        break;
      }
      case 'add_background_item':
      case 'update_background_item':
      case 'remove_background_item':
        mutateReviewedCollection(draft, mutation, now, 'background');
        break;
      case 'add_scientific_question':
      case 'update_scientific_question':
      case 'remove_scientific_question':
        mutateReviewedCollection(draft, mutation, now, 'question');
        break;
      case 'add_innovation_point':
      case 'update_innovation_point':
      case 'remove_innovation_point':
        mutateReviewedCollection(draft, mutation, now, 'innovation');
        break;
      case 'add_limitation_point':
      case 'update_limitation_point':
      case 'remove_limitation_point':
        mutateReviewedCollection(draft, mutation, now, 'limitation');
        break;
      case 'seed_generated_meta':
        if (Object.hasOwn(mutation, 'backgroundItems')) {
          if (!Array.isArray(mutation.backgroundItems)) {
            throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
          }
          draft.meta.backgroundItems = seedGeneratedMetaCollection(
            draft.meta.backgroundItems, mutation.backgroundItems
          );
        }
        if (Object.hasOwn(mutation, 'scientificQuestions')) {
          if (!Array.isArray(mutation.scientificQuestions)) {
            throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
          }
          draft.meta.scientificQuestions = seedGeneratedScientificQuestions(
            draft.meta.scientificQuestions, mutation.scientificQuestions
          );
        }
        for (const key of ['innovationPoints', 'limitationPoints']) {
          if (!Object.hasOwn(mutation, key)) continue;
          if (!Array.isArray(mutation[key])) {
            throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
          }
          draft.meta[key] = seedGeneratedMetaCollection(draft.meta[key], mutation[key]);
        }
        break;
      case 'seed_research_logic':
        if (!isPlainObject(mutation.researchLogic)) {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        draft.meta.researchLogic = normalizeResearchLogic(mutation.researchLogic);
        projectResearchLogicToLegacyMeta(draft, {
          overwriteReviewedEmpty: mutation.overwriteReviewedEmpty === true
        });
        break;
      case 'seed_innovation_points':
        seedIndependentPaperPoints(
          draft, mutation.innovationPoints, 'innovationPoints', {
            overwriteReviewedEmpty: mutation.overwriteReviewedEmpty === true
          }
        );
        break;
      case 'seed_limitation_points':
        seedIndependentPaperPoints(
          draft, mutation.limitationPoints, 'limitationPoints', {
            overwriteReviewedEmpty: mutation.overwriteReviewedEmpty === true
          }
        );
        break;
      case 'set_supplemental_placements':
        if (!Array.isArray(mutation.placements)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        draft.supplementalPlacements = normalizeSupplementalPlacements(mutation.placements);
        break;
      case 'set_figure_display_order':
        // Already validated against the caller's current independent inventory.
        draft.figureDisplayOrder = mutation.figureIds.slice();
        break;
      case 'add_mechanism_node':
        addMechanismNode(draft, mutation.node, now);
        break;
      case 'insert_mechanism_node':
        insertMechanismNode(draft, mutation.node, mutation.index, mutation.edgeId, now);
        break;
      case 'add_mechanism_branch':
        addMechanismBranch(draft, mutation.node, mutation.edge, now);
        break;
      case 'seed_mechanism_chain':
        seedMechanismChain(draft, mutation.chain);
        break;
      case 'replace_mechanism_chain':
        seedMechanismChain(draft, mutation.chain, true);
        break;
      case 'replace_generated_mechanism_v2':
        replaceGeneratedMechanismV2(draft, mutation, now);
        break;
      case 'import_mechanism_chain':
        importReviewedMechanismChain(draft, mutation.chain);
        break;
      case 'import_mechanism_workspace':
        importMechanismWorkspace(draft, mutation);
        break;
      case 'update_mechanism_node': {
        requireAllowedField(mutation.field, new Set(['label']));
        if (typeof mutation.value !== 'string') {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        requireMechanismItem(draft.mechanismChain.nodes, mutation.nodeId).label =
          reviewedValue(mutation.value, now);
        clearMechanismNodeTombstone(draft.mechanismChain, mutation.nodeId);
        draft.mechanismChain.initialized = true;
        break;
      }
      case 'reorder_mechanism_node': {
        const node = requireMechanismItem(draft.mechanismChain.nodes, mutation.nodeId);
        const from = draft.mechanismChain.nodes.indexOf(node);
        const to = requireCollectionIndex(mutation.index, draft.mechanismChain.nodes.length);
        draft.mechanismChain.nodes.splice(from, 1);
        draft.mechanismChain.nodes.splice(to, 0, node);
        draft.mechanismChain.initialized = true;
        break;
      }
      case 'remove_mechanism_node':
        removeMechanismNode(draft, mutation.nodeId, now);
        break;
      case 'set_mechanism_panel_alias': {
        if (typeof mutation.value !== 'string') {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        const key = requireExistingPanelKey(draft, mutation.figureId, mutation.panelId);
        const alias = reviewedValue(mutation.value, now);
        if (alias.value) draft.mechanismChain.panelAliases[key] = alias;
        else delete draft.mechanismChain.panelAliases[key];
        draft.mechanismChain.initialized = true;
        break;
      }
      case 'add_mechanism_edge':
        addMechanismEdge(draft, mutation.edge, now);
        break;
      case 'upsert_mechanism_cell_evidence':
        upsertMechanismCellEvidence(draft, mutation, now);
        break;
      case 'update_mechanism_edge': {
        const edge = requireMechanismItem(draft.mechanismChain.edges, mutation.edgeId);
        if (typeof mutation.field !== 'string') {
          throw workspaceError('FIGURE_WORKSPACE_FIELD_INVALID');
        }
        const field = mutation.field;
        if (field === 'panelEvidence') {
          if (!Array.isArray(mutation.value)) {
            throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
          }
          const previousEvidence = edge.panelEvidence;
          const nextEvidence = cappedArrayValues(mutation.value, MAX_PANEL_IDS_PER_BLOCK)
            .map(item => reviewedPanelEvidenceReference(draft, item, now));
          previousEvidence.filter(previous => !nextEvidence.some(item =>
            item.figureId === previous.figureId && item.panelId === previous.panelId
          )).forEach(item => addMechanismEvidenceTombstone(
            draft.mechanismChain, edge, item, now
          ));
          edge.panelEvidence = nextEvidence;
          nextEvidence.forEach(item => clearMechanismEvidenceTombstone(
            draft.mechanismChain, edge, item
          ));
          break;
        }
        requireAllowedField(field, EDGE_SCALAR_FIELDS);
        if (field === 'label') {
          if (typeof mutation.value !== 'string') {
            throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
          }
          edge[field] = reviewedValue(mutation.value, now);
        } else if (field === 'polarity') {
          edge.polarity = requireMechanismPolarity(mutation.value, false);
        } else {
          const previousEdge = { ...edge };
          const endpoint = safeId(mutation.value, 80);
          if (!endpoint) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
          if (!draft.mechanismChain.nodes.some(node => node.id === endpoint)) {
            throw workspaceError('FIGURE_WORKSPACE_TARGET_NOT_FOUND');
          }
          edge[field] = endpoint;
          addMechanismEdgeTombstone(draft.mechanismChain, previousEdge, now);
          clearMechanismEdgeTombstone(draft.mechanismChain, edge);
        }
        validateMechanismEdgeSemantics(draft, edge, edge.id);
        edge.humanReviewed = true;
        edge.editedAt = boundedTimestamp(now);
        draft.mechanismChain.initialized = true;
        break;
      }
      case 'set_mechanism_layout_preferences': {
        const layoutPreferences = normalizeMechanismLayoutPreferences(
          mutation.layoutPreferences,
          draft.mechanismChain.nodes.map(node => node.id)
        );
        if (hasMechanismLayoutPreferences(layoutPreferences)) {
          draft.mechanismChain.layoutPreferences = layoutPreferences;
        } else {
          delete draft.mechanismChain.layoutPreferences;
        }
        draft.mechanismChain.initialized = true;
        break;
      }
      case 'add_mechanism_edge_evidence': {
        const edge = requireMechanismItem(draft.mechanismChain.edges, mutation.edgeId);
        if (edge.panelEvidence.length >= MAX_PANEL_IDS_PER_BLOCK) {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        const evidence = reviewedPanelEvidenceReference(
          draft, mutation.evidence, now
        );
        edge.panelEvidence.push(evidence);
        clearMechanismEvidenceTombstone(draft.mechanismChain, edge, evidence);
        draft.mechanismChain.initialized = true;
        break;
      }
      case 'update_mechanism_edge_evidence': {
        const edge = requireMechanismItem(draft.mechanismChain.edges, mutation.edgeId);
        const index = requireCollectionIndex(mutation.index, edge.panelEvidence.length);
        if (typeof mutation.expectedFigureId !== 'string' ||
            typeof mutation.expectedPanelId !== 'string') {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        const expectedFigureId = safeId(mutation.expectedFigureId, 160);
        const expectedPanelId = safePanelId(mutation.expectedPanelId);
        if ((mutation.expectedFigureId && !expectedFigureId) ||
            (mutation.expectedPanelId && !expectedPanelId)) {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        const currentEvidence = edge.panelEvidence[index];
        if (currentEvidence.figureId !== expectedFigureId ||
            currentEvidence.panelId !== expectedPanelId) {
          throw workspaceError('FIGURE_WORKSPACE_PANEL_CONTEXT_STALE');
        }
        const nextEvidence = reviewedPanelEvidenceReference(
          draft, mutation.evidence, now
        );
        if (currentEvidence.figureId !== nextEvidence.figureId ||
            currentEvidence.panelId !== nextEvidence.panelId) {
          addMechanismEvidenceTombstone(
            draft.mechanismChain, edge, currentEvidence, now
          );
        }
        edge.panelEvidence[index] = nextEvidence;
        clearMechanismEvidenceTombstone(draft.mechanismChain, edge, nextEvidence);
        draft.mechanismChain.initialized = true;
        break;
      }
      case 'remove_mechanism_edge_evidence': {
        const edge = requireMechanismItem(draft.mechanismChain.edges, mutation.edgeId);
        const index = requireCollectionIndex(mutation.index, edge.panelEvidence.length);
        if (typeof mutation.expectedFigureId !== 'string' ||
            typeof mutation.expectedPanelId !== 'string') {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        const expectedFigureId = safeId(mutation.expectedFigureId, 160);
        const expectedPanelId = safePanelId(mutation.expectedPanelId);
        if ((mutation.expectedFigureId && !expectedFigureId) ||
            (mutation.expectedPanelId && !expectedPanelId)) {
          throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
        }
        const currentEvidence = edge.panelEvidence[index];
        if (currentEvidence.figureId !== expectedFigureId ||
            currentEvidence.panelId !== expectedPanelId) {
          throw workspaceError('FIGURE_WORKSPACE_PANEL_CONTEXT_STALE');
        }
        addMechanismEvidenceTombstone(
          draft.mechanismChain, edge, currentEvidence, now
        );
        edge.panelEvidence.splice(index, 1);
        draft.mechanismChain.initialized = true;
        break;
      }
      case 'remove_mechanism_edge': {
        const edge = requireMechanismItem(draft.mechanismChain.edges, mutation.edgeId);
        addMechanismEdgeTombstone(draft.mechanismChain, edge, now);
        draft.mechanismChain.edges.splice(draft.mechanismChain.edges.indexOf(edge), 1);
        draft.mechanismChain.initialized = true;
        break;
      }
      case 'restore_model_value':
        restoreModelValue(draft, mutation);
        break;
      default:
        throw workspaceError('FIGURE_WORKSPACE_MUTATION_UNKNOWN');
    }
    if (previousDrawingChain && mutation.type !== 'apply_mechanism_canvas_command' &&
        mutation.type !== 'import_mechanism_workspace' && mutation.type !== 'import_mechanism_chain') {
      draft.mechanismChain = canvasContracts.reconcileMechanismCanvasDrawing(
        previousDrawingChain, draft.mechanismChain, { figures: draft.figures });
    }
    const preservesMechanismGeneration =
      mutation.type === 'replace_generated_mechanism_v2' ||
      mutation.type === 'import_mechanism_workspace' ||
      mutation.type === 'set_mechanism_panel_alias' ||
      mutation.type === 'set_mechanism_layout_preferences' ||
      (mutation.type === 'apply_mechanism_canvas_command' &&
        canvasPresentation);
    if (!preservesMechanismGeneration &&
        (mutation.type.includes('mechanism') || mutation.type === 'remove_panel')) {
      delete draft.mechanismGeneration;
    }
  }

  function semanticDraftFingerprint(draft) {
    return JSON.stringify(draft, (key, value) =>
      key === 'revision' || key === 'editedAt' ? 0 : value
    );
  }

  function importedWorkspaceFingerprint(draft) {
    return JSON.stringify(draft, (key, value) => key === 'revision' ? 0 : value);
  }

  // A valid semantic no-op returns a fresh normalized draft and preserves the
  // current revision. Successful changes increment the revision exactly once.
  function applyFigureWorkspaceMutation(value, rawMutation, now = Date.now(), options = {}) {
    const trustedInput = TRUSTED_FIGURE_WORKSPACE_DRAFTS.has(value);
    const current = normalizeFigureWorkspaceDraft(value);
    if (!isPlainObject(rawMutation)) throw workspaceError('FIGURE_WORKSPACE_MUTATION_INVALID');
    const mutation = ownRecord(rawMutation, MUTATION_KEYS);
    if (typeof mutation.type !== 'string' || !mutation.type) {
      throw workspaceError('FIGURE_WORKSPACE_MUTATION_INVALID');
    }
    if (typeof mutation.expectedRevision !== 'number' ||
        !Number.isSafeInteger(mutation.expectedRevision) || mutation.expectedRevision < 0) {
      throw workspaceError('FIGURE_WORKSPACE_MUTATION_INVALID');
    }
    const expectedRevision = mutation.expectedRevision;
    if (expectedRevision !== current.revision) {
      throw workspaceError('FIGURE_WORKSPACE_REVISION_CONFLICT');
    }
    if (mutation.type === 'set_figure_display_order') {
      mutation.figureIds = validateFigureDisplayOrderMutation(current, rawMutation, mutation, options);
    }
    if (mutation.type === 'replace_generated_mechanism_v2') {
      const generation = parseGenerationCandidateEnvelope(
        mutation.generationEnvelope
      );
      const preview = generation?.preview;
      const rawDraft = ownRecord(value, ROOT_KEYS);
      if (!trustedInput || !preview || !strictExistingMechanismReviewForGeneration(
        rawDraft.mechanismChain, preview
      )) throw workspaceError('FIGURE_WORKSPACE_GENERATED_MECHANISM_INVALID');
    }
    if (mutation.type === 'import_mechanism_workspace' &&
        mutation.mechanismGeneration !== null && !trustedInput) {
      throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
    }
    if (mutation.type === 'import_mechanism_workspace') {
      return prepareMechanismWorkspaceImport(current, mutation, trustedInput);
    }
    const next = normalizeFigureWorkspaceDraft(current);
    applyMutationToDraft(next, mutation, boundedTimestamp(now));
    if (aggregateDraftTextCharacters(next) > FIGURE_WORKSPACE_TEXT_BUDGET ||
        serializedDraftLength(next) > FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS) {
      throw workspaceError('FIGURE_WORKSPACE_BUDGET_EXCEEDED');
    }
    const normalized = normalizeFigureWorkspaceDraft(next);
    const unchanged = mutation.type === 'import_mechanism_workspace'
      ? importedWorkspaceFingerprint(normalized) === importedWorkspaceFingerprint(current)
      : semanticDraftFingerprint(normalized) === semanticDraftFingerprint(current);
    if (unchanged) return current;
    if (current.revision >= MAX_REVISION) throw workspaceError('FIGURE_WORKSPACE_REVISION_LIMIT');
    normalized.revision = mutation.type === 'import_mechanism_workspace'
      ? Math.max(current.revision + 1, normalized.revision)
      : current.revision + 1;
    return normalized;
  }

  function publicFigureWorkspaceDraft(value) {
    return normalizeFigureWorkspaceDraft(value);
  }

  function setLegacyReviewedScalar(target, field, value, editedAt, tracker) {
    if (!Object.hasOwn(target, field) || target[field].humanReviewed) return false;
    return tracker.tryReplace(target, field, reviewedValue(value, editedAt));
  }

  function setLegacyReviewedList(target, field, value, editedAt, tracker) {
    if (!Object.hasOwn(target, field) || target[field].some(item => item.humanReviewed)) return false;
    return tracker.tryReplace(
      target, field, reviewedList(Array.isArray(value) ? value : [], editedAt)
    );
  }

  function migrateLegacyPatch(draft, figureId, patch, fallbackNow, tracker) {
    if (!isPlainObject(patch) || !Object.hasOwn(draft.figures, figureId)) return false;
    const source = ownRecord(patch, ['editedAt', 'fields', 'listFields', 'panels']);
    const editedAt = boundedTimestamp(source.editedAt) || boundedTimestamp(fallbackNow);
    const figure = draft.figures[figureId];
    let changed = false;
    const fields = ownRecord(source.fields, [
      'figureQuestion', 'coreConclusion', 'claimBoundary', 'authorAssembly', 'remainingQuestion'
    ]);
    for (const field of OVERVIEW_KEYS) {
      if (Object.hasOwn(fields, field)) {
        changed = setLegacyReviewedScalar(
          figure.overview, field, fields[field], editedAt, tracker
        ) || changed;
      }
    }
    const panelPatches = cappedMapEntries(source.panels, MAX_PANELS_PER_FIGURE);
    for (const [rawPanelId, rawPanelPatch] of panelPatches) {
      const panelId = safePanelId(rawPanelId);
      if (!panelId || !Object.hasOwn(figure.panels, panelId) || !isPlainObject(rawPanelPatch)) continue;
      const panel = figure.panels[panelId];
      const panelPatch = ownRecord(rawPanelPatch, [
        ...PANEL_SCALAR_FIELDS, 'methods', 'experimentalMethods', 'statisticalMethods'
      ]);
      for (const field of PANEL_SCALAR_FIELDS) {
        if (Object.hasOwn(panelPatch, field)) {
          const fieldChanged = setLegacyReviewedScalar(
            panel, field, panelPatch[field], editedAt, tracker
          );
          if (fieldChanged && generatedAuditReferencesPanelField(
            draft.mechanismGeneration, figureId, panelId, field
          )) delete draft.mechanismGeneration;
          changed = fieldChanged || changed;
        }
      }
      if (Object.hasOwn(panelPatch, 'experimentalMethods') || Object.hasOwn(panelPatch, 'methods')) {
        const fieldChanged = setLegacyReviewedList(panel, 'experimentalMethods',
          panelPatch.experimentalMethods ?? panelPatch.methods, editedAt, tracker);
        if (fieldChanged && generatedAuditReferencesPanelField(
          draft.mechanismGeneration, figureId, panelId, 'experimentalMethods'
        )) delete draft.mechanismGeneration;
        changed = fieldChanged || changed;
      }
      if (Object.hasOwn(panelPatch, 'statisticalMethods')) {
        const fieldChanged = setLegacyReviewedList(panel, 'statisticalMethods',
          panelPatch.statisticalMethods, editedAt, tracker);
        if (fieldChanged && generatedAuditReferencesPanelField(
          draft.mechanismGeneration, figureId, panelId, 'statisticalMethods'
        )) delete draft.mechanismGeneration;
        changed = fieldChanged || changed;
      }
    }
    return changed;
  }

  function migrateLegacyFigureManualEdits(value, legacyFigures, now = Date.now()) {
    const preserveCapability = Boolean(value && typeof value === 'object' &&
      TRUSTED_FIGURE_WORKSPACE_DRAFTS.has(value));
    const current = normalizeFigureWorkspaceDraft(value);
    const next = cloneNormalizedWorkspaceValue(current);
    // Reserve one character for the bounded revision increment. Legacy values are
    // then admitted independently without ever re-normalizing the protected base.
    const tracker = createWorkspaceBudgetTracker(next, 1);
    let changed = false;
    for (const rawFigure of cappedArrayValues(legacyFigures, MAX_FIGURES)) {
      if (!isPlainObject(rawFigure)) continue;
      const source = ownRecord(rawFigure, ['figureId', 'id', 'activeDepth', 'manualEdits']);
      const figureId = safeId(source.figureId || source.id);
      if (!figureId || !Object.hasOwn(next.figures, figureId)) continue;
      const edits = ownRecord(source.manualEdits, ['standard', 'deep']);
      const preferred = source.activeDepth === 'deep' ? ['deep', 'standard'] : ['standard', 'deep'];
      for (const depth of preferred) {
        changed = migrateLegacyPatch(next, figureId, edits[depth], now, tracker) || changed;
      }
    }
    if (!changed) return current;
    if (current.revision >= MAX_REVISION) throw workspaceError('FIGURE_WORKSPACE_REVISION_LIMIT');
    next.revision = current.revision + 1;
    // The tracker is conservative, but retain a final exact invariant check. A
    // mismatch can only discard newly admitted legacy edits, never base content.
    if (draftExceedsWorkspaceBudget(next)) return current;
    if (preserveCapability) TRUSTED_FIGURE_WORKSPACE_DRAFTS.add(next);
    return next;
  }

  function normalizeCheckpointToken(value) {
    const source = ownRecord(value, ['revision', 'contentHash', 'writeToken']);
    const writeToken = boundedText(source.writeToken, 160);
    return {
      revision: Number.isSafeInteger(source.revision) && source.revision >= 0
        ? source.revision : 0,
      contentHash: boundedText(source.contentHash, 160),
      ...(/^workspace-write-v1-[a-f0-9]{16,64}$/u.test(writeToken)
        ? { writeToken } : {})
    };
  }

  function initializeFigureWorkspaceDraftState(options = {}) {
    if (!isPlainObject(options)) throw workspaceError('FIGURE_WORKSPACE_ASSET_INVALID');
    const durableAsset = options.durableAsset;
    const hasDurableAsset = durableAsset !== null && durableAsset !== undefined;
    let checkpoint = normalizeCheckpointToken(null);
    let durableDraft = null;
    let durableContentCanonical = true;
    if (hasDurableAsset) {
      if (!isPlainObject(durableAsset)) throw workspaceError('FIGURE_WORKSPACE_ASSET_INVALID');
      const asset = ownRecord(
        durableAsset, ['content', 'revision', 'contentHash', 'writeToken']
      );
      if (!isPlainObject(asset.content) || !Number.isSafeInteger(asset.revision) ||
          asset.revision < 0 || typeof asset.contentHash !== 'string' || !asset.contentHash) {
        throw workspaceError('FIGURE_WORKSPACE_ASSET_INVALID');
      }
      checkpoint = normalizeCheckpointToken(asset);
      if (!checkpoint.contentHash) throw workspaceError('FIGURE_WORKSPACE_ASSET_INVALID');
      durableDraft = normalizeFigureWorkspaceDraftFromStorage(asset.content);
      durableContentCanonical = boundedContentFingerprint(asset.content, durableDraft) ===
        boundedContentFingerprint(durableDraft, durableDraft);
    }
    const binding = normalizeFigureWorkspaceBinding(options.binding);
    const memoryDraft = normalizeFigureWorkspaceDraft(options.memoryDraft);
    // A web workspace belongs to the canonical article, not one extraction of
    // its body. Caption expansion and publisher DOM changes can revise both
    // document hashes while the durable owner remains the same. Only the web
    // reader opts into this transition; PDF and foreign-owner checks stay strict.
    const comparison = JSON.stringify(durableDraft || normalizeFigureWorkspaceDraft(null));
    for (const candidate of [durableDraft, memoryDraft]) {
      if (binding && candidate?.binding &&
          !sameFigureWorkspaceBinding(binding, candidate.binding)) {
        const sameWebOwner = options.allowDocumentRevisionUpdate === true &&
          /^https?:\/\//u.test(binding.canonicalUrl) &&
          ['canonicalUrl', 'workspaceId', 'workspaceGeneration'].every(key =>
            candidate.binding[key] === binding[key]);
        if (!sameWebOwner) throw workspaceError('FIGURE_WORKSPACE_BINDING_MISMATCH');
        candidate.binding = { ...binding };
      }
    }
    const preferMemoryDraft = options.preferMemoryDraft === true && binding &&
      sameFigureWorkspaceBinding(binding, memoryDraft.binding);
    const base = preferMemoryDraft ? memoryDraft : (durableDraft || memoryDraft);
    if (binding && base.binding && !sameFigureWorkspaceBinding(binding, base.binding)) {
      throw workspaceError('FIGURE_WORKSPACE_BINDING_MISMATCH');
    }
    if (binding && !base.binding) base.binding = binding;
    let draft = createFigureWorkspaceDraft(
      Array.isArray(options.inventory) ? options.inventory : [], base
    );
    draft = migrateLegacyFigureManualEdits(
      draft, Array.isArray(options.legacyFigures) ? options.legacyFigures : []
    );
    return {
      draft,
      checkpoint,
      dirty: !durableContentCanonical || JSON.stringify(draft) !== comparison
    };
  }

  function createFigureWorkspaceDraftController(options = {}) {
    if (!isPlainObject(options) || typeof options.persist !== 'function') {
      throw workspaceError('FIGURE_WORKSPACE_CONTROLLER_INVALID');
    }
    let draft = normalizeFigureWorkspaceDraft(options.initialDraft);
    const binding = normalizeFigureWorkspaceBinding(options.binding);
    const bindingWasAttached = Boolean(binding && !draft.binding);
    if (binding && draft.binding && !sameFigureWorkspaceBinding(binding, draft.binding)) {
      throw workspaceError('FIGURE_WORKSPACE_BINDING_MISMATCH');
    }
    if (binding && !draft.binding) draft.binding = binding;
    let checkpoint = normalizeCheckpointToken(options.initialCheckpoint);
    let dirty = options.initialDirty === true || bindingWasAttached;
    let reloadRequired = false;
    let tail = Promise.resolve();
    const getLifecycle = typeof options.getLifecycle === 'function'
      ? options.getLifecycle : () => 0;
    const notify = typeof options.notify === 'function' ? options.notify : () => {};

    function lifecycleError() {
      return workspaceError('FIGURE_WORKSPACE_LIFECYCLE_CHANGED');
    }

    function enqueue(work) {
      const lifecycle = getLifecycle();
      const operation = tail.then(async () => {
        if (getLifecycle() !== lifecycle) throw lifecycleError();
        if (reloadRequired) throw workspaceError('FIGURE_WORKSPACE_RELOAD_REQUIRED');
        return work(lifecycle);
      });
      tail = operation.catch(() => undefined);
      return operation;
    }

    async function persistNext(next, lifecycle, force = false, preCommit = null, canRefresh = true) {
      const assertCommitCurrent = typeof preCommit === 'function' ? () => {
        const guardResult = preCommit({
          draft: publicFigureWorkspaceDraft(next),
          expectedRevision: checkpoint.revision,
          expectedContentHash: checkpoint.contentHash,
          ...(checkpoint.writeToken ? { expectedWriteToken: checkpoint.writeToken } : {})
        });
        if (guardResult && typeof guardResult.then === 'function') {
          throw workspaceError('FIGURE_WORKSPACE_PRECOMMIT_GUARD_INVALID');
        }
        return true;
      } : null;
      if (assertCommitCurrent) assertCommitCurrent();
      let saved;
      try {
        saved = await options.persist({
          draft: publicFigureWorkspaceDraft(next),
          expectedRevision: checkpoint.revision,
          expectedContentHash: checkpoint.contentHash,
          ...(checkpoint.writeToken ? { expectedWriteToken: checkpoint.writeToken } : {}),
          ...(assertCommitCurrent ? { assertCommitCurrent } : {}),
          force
        });
      } catch (error) {
        // A directory restore can advance the storage revision without changing
        // the draft. Rebase only that metadata-only case, once. A peer edit or
        // a different document must still fail its compare-and-swap.
        if (canRefresh && error?.code === 'ASSET_REVISION_CONFLICT' &&
            typeof options.readCheckpoint === 'function') {
          const asset = await options.readCheckpoint();
          if (getLifecycle() !== lifecycle) throw lifecycleError();
          const source = ownRecord(asset, ['revision', 'contentHash', 'writeToken', 'content']);
          const fresh = normalizeCheckpointToken(source);
          if (Number.isSafeInteger(source.revision) && source.revision >= 0 &&
              fresh.contentHash && isPlainObject(source.content) &&
              figureWorkspaceAssetContentFingerprint(source.content) === fresh.contentHash) {
            const authoritative = normalizeFigureWorkspaceDraftFromStorage(source.content);
            // Directory JSON canonicalizes object keys; compare complete values
            // without making key insertion order part of the CAS identity.
            // Array order, binding, user edits and draft revision remain exact.
            const canonicalDraftText = value => JSON.stringify(
              publicFigureWorkspaceDraft(value), (_key, item) => isPlainObject(item)
                ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
                : item
            );
            if (canonicalDraftText(authoritative) === canonicalDraftText(draft)) {
              checkpoint = fresh;
              return persistNext(next, lifecycle, force, preCommit, false);
            }
          }
        }
        const rollbackSource = ownRecord(error?.rollbackCheckpoint, [
          'revision', 'contentHash', 'writeToken', 'content', 'requiresReload'
        ]);
        const rollback = normalizeCheckpointToken(rollbackSource);
        const hasRollbackReceipt = Number.isSafeInteger(rollbackSource.revision) &&
          rollbackSource.revision >= 0 && Boolean(rollback.contentHash);
        let adopted = false;
        if (hasRollbackReceipt && isPlainObject(rollbackSource.content)) {
          const rawFingerprint = figureWorkspaceAssetContentFingerprint(
            rollbackSource.content
          );
          if (rawFingerprint && rawFingerprint === rollback.contentHash) {
            const authoritative = normalizeFigureWorkspaceDraftFromStorage(
              rollbackSource.content
            );
            const canonicalFingerprint = figureWorkspaceAssetContentFingerprint(
              publicFigureWorkspaceDraft(authoritative)
            );
            const bindingMatches = !binding || !authoritative.binding ||
              sameFigureWorkspaceBinding(binding, authoritative.binding);
            if (canonicalFingerprint === rawFingerprint && bindingMatches) {
              draft = authoritative;
              checkpoint = rollback;
              dirty = false;
              reloadRequired = false;
              adopted = true;
            }
          }
        }
        if (!adopted && (hasRollbackReceipt || rollbackSource.requiresReload === true)) {
          reloadRequired = true;
        }
        throw error;
      }
      const token = normalizeCheckpointToken(saved);
      if (!Number.isSafeInteger(saved?.revision) || saved.revision < 0 || !token.contentHash) {
        throw workspaceError('FIGURE_WORKSPACE_CHECKPOINT_INVALID');
      }
      checkpoint = token;
      return { token, stale: getLifecycle() !== lifecycle };
    }

    function seededDraft(figures) {
      if (!Array.isArray(figures)) throw workspaceError('FIGURE_WORKSPACE_VALUE_INVALID');
      const next = createFigureWorkspaceDraft(figures, draft);
      if (semanticDraftFingerprint(next) === semanticDraftFingerprint(draft)) return draft;
      if (draft.revision >= MAX_REVISION) throw workspaceError('FIGURE_WORKSPACE_REVISION_LIMIT');
      next.revision = draft.revision + 1;
      return normalizeFigureWorkspaceDraft(next);
    }

    return {
      getDraft() { return publicFigureWorkspaceDraft(draft); },
      getBinding() { return draft.binding ? { ...draft.binding } : null; },
      getCheckpoint() { return { ...checkpoint }; },
      isDirty() { return dirty; },
      mutate(mutation, now = Date.now()) {
        return enqueue(async lifecycle => {
          const isDisplayOrder = ownRecord(mutation, ['type']).type === 'set_figure_display_order';
          let inventory, preCommit = null;
          if (isDisplayOrder) {
            const getInventory = ownRecord(options, ['getInventory']).getInventory;
            if (typeof getInventory !== 'function') {
              throw workspaceError('FIGURE_WORKSPACE_DISPLAY_ORDER_INVENTORY_REQUIRED');
            }
            inventory = getInventory();
            const identity = JSON.stringify(readFigureDisplayInventory(inventory).sort());
            preCommit = () => {
              let currentIdentity;
              try { currentIdentity = JSON.stringify(readFigureDisplayInventory(getInventory()).sort()); }
              catch (_) { throw workspaceError('FIGURE_WORKSPACE_DISPLAY_ORDER_INVENTORY_STALE'); }
              if (identity !== currentIdentity) {
                throw workspaceError('FIGURE_WORKSPACE_DISPLAY_ORDER_INVENTORY_STALE');
              }
            };
          }
          const next = applyFigureWorkspaceMutation(draft, mutation, now,
            isDisplayOrder ? { inventory } : undefined);
          const changed = next.revision !== draft.revision;
          if (!changed && !dirty) {
            return { success: true, unchanged: true, draft: publicFigureWorkspaceDraft(draft) };
          }
          const persisted = await persistNext(next, lifecycle, false, preCommit);
          draft = next;
          dirty = false;
          if (changed && !persisted.stale) try {
            notify({
              kind: 'figure_workspace_draft_updated',
              mutationType: boundedText(mutation?.type, 80),
              revision: draft.revision
            });
          } catch (_) {}
          return {
            success: true,
            stale: persisted.stale,
            draft: publicFigureWorkspaceDraft(draft)
          };
        });
      },
      seedFigures(figures) {
        return enqueue(async lifecycle => {
          const next = seededDraft(figures);
          const changed = next.revision !== draft.revision;
          if (!changed && !dirty) {
            return { success: true, unchanged: true, draft: publicFigureWorkspaceDraft(draft) };
          }
          const persisted = await persistNext(next, lifecycle, false);
          draft = next;
          dirty = false;
          if (changed && !persisted.stale) try {
            notify({
              kind: 'figure_workspace_draft_seeded',
              mutationType: 'seed_figures',
              revision: draft.revision
            });
          } catch (_) {}
          return {
            success: true,
            stale: persisted.stale,
            draft: publicFigureWorkspaceDraft(draft)
          };
        });
      },
      mergeModel(figure, modelResult, mergeOptions = {}) {
        return enqueue(async lifecycle => {
          const next = mergeModelIntoFigureWorkspaceDraft(draft, figure, modelResult);
          const changed = next.revision !== draft.revision;
          const preCommit = isPlainObject(mergeOptions) &&
            typeof mergeOptions.preCommit === 'function'
            ? mergeOptions.preCommit : null;
          // A guarded final merge still needs its owner check and durable confirmation,
          // even when an earlier partial checkpoint already contains the same model.
          if (!changed && !dirty && !preCommit) {
            return { success: true, unchanged: true, draft: publicFigureWorkspaceDraft(draft) };
          }
          const persisted = await persistNext(next, lifecycle, false, preCommit);
          draft = next;
          dirty = false;
          if (changed && !persisted.stale) try {
            notify({
              kind: 'figure_workspace_draft_model_merged',
              mutationType: 'merge_model_result',
              revision: draft.revision
            });
          } catch (_) {}
          return {
            success: true,
            stale: persisted.stale,
            draft: publicFigureWorkspaceDraft(draft)
          };
        });
      },
      flush() {
        return enqueue(async lifecycle => {
          if (!dirty) {
            return { success: true, unchanged: true, draft: publicFigureWorkspaceDraft(draft) };
          }
          const persisted = await persistNext(draft, lifecycle, true);
          dirty = false;
          return {
            success: true,
            stale: persisted.stale,
            draft: publicFigureWorkspaceDraft(draft)
          };
        });
      }
    };
  }

  return {
    FIGURE_WORKSPACE_DRAFT_VERSION,
    FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS,
    editableValue,
    compactPanelId,
    figurePanelDisplayId,
    formatCompactFigurePanelId,
    mechanismChainFromCrossFigure,
    mechanismPanelEvidenceOptions,
    resolveMechanismPanelEvidenceReference,
    mechanismChainValidationIssues,
    buildEvidenceBlocks,
    buildFigureEvidenceDisplayLayout,
    normalizeSupplementalPlacements,
    orderFigureWorkspaceItems,
    figureWorkspaceAnchorToken,
    figureWorkspaceAnchorId,
    createFigureWorkspacePanelDescriptor,
    normalizeFigureWorkspaceDraft,
    createFigureWorkspaceDraft,
    mergeModelIntoFigureWorkspaceDraft,
    prepareFigureWorkspaceViewContext,
    figureWorkspaceViewInputFingerprint,
    createFigureWorkspaceView,
    createPanelEightFieldView,
    mergeFigureWorkspaceValue,
    applyFigureWorkspaceMutation,
    validateMechanismWorkspaceImport,
    isCanonicalMechanismWorkspaceText,
    isCanonicalMechanismWorkspaceNodeLabel,
    isCanonicalMechanismWorkspacePanelReference,
    publicFigureWorkspaceDraft,
    normalizeGeneratedMechanismPreview,
    createMechanismGenerationCandidateEnvelope,
    readMechanismGenerationEnvelope,
    readMechanismGenerationAudit,
    stripExplicitAuthorizationCredentials,
    migrateLegacyFigureManualEdits,
    figureWorkspaceAssetContentFingerprint,
    initializeFigureWorkspaceDraftState,
    createFigureWorkspaceDraftController
  };
});
