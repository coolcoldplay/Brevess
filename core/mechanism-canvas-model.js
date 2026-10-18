(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(host) {
  'use strict';
  const TYPES = ['sufficient', 'necessary', 'related'];
  const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);
  const MAX_NODES = 64, MAX_EDGES = 64, MAX_BINDINGS = 512, MAX_STAGES = 64;
  const MAX_STORY_BINDINGS = MAX_BINDINGS + MAX_EDGES * 32;
  const DRAWING_KEYS = ['schemaVersion', 'positions', 'viewport', 'matrixHeight',
    'mode', 'activeStageId', 'bindings', 'edgeContexts', 'story', 'legacyEvidence'];
  const CONTEXT_KEYS = ['species', 'tissue', 'model', 'time', 'condition',
    'predicate', 'effect', 'summary', 'cellType', 'compartment', 'timepoint', 'dose'];
  function error(code) { const result = new Error(code); result.code = code; return result; }
  function fail(code = 'FIGURE_WORKSPACE_CANVAS_INVALID') { throw error(code); }
  function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return {};
      const result = {};
      for (const key of Object.keys(value)) {
        if (BLOCKED.has(key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && Object.hasOwn(descriptor, 'value')) result[key] = descriptor.value;
      }
      return result;
    } catch (_) { return {}; }
  }
  function list(value, limit = 512) {
    if (!Array.isArray(value)) return [];
    const result = [];
    try {
      const length = Math.min(value.length, limit);
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (descriptor && Object.hasOwn(descriptor, 'value')) result.push(descriptor.value);
      }
    } catch (_) { return []; }
    return result;
  }
  function text(value, maximum = 4000, depth = 0) {
    if (depth > 4 || value === undefined || value === null) return '';
    if (typeof value === 'string') return value.normalize('NFC')
      .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);
    if (Array.isArray(value)) return list(value, 32).map(item => text(item, maximum, depth + 1)).filter(Boolean).join('；').slice(0, maximum);
    return text(record(value).value, maximum, depth + 1);
  }
  function nodeText(value, depth = 0) {
    if (depth > 4) return '';
    if (typeof value !== 'string') return nodeText(record(value).value, depth + 1);
    return value.normalize('NFC').replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 4000);
  }
  function id(value, maximum = 160) {
    const result = text(value, maximum);
    return result && !BLOCKED.has(result) && !/\s/u.test(result) ? result : '';
  }
  function ids(value, maximum = 64) { return [...new Set(list(value, maximum).map(item => id(item)).filter(Boolean))]; }
  function finite(value, fallback = 0, minimum = -100000, maximum = 100000) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(minimum, Math.min(maximum, value)) : fallback;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function assertData(value, depth = 0, seen = new WeakSet()) {
    if (!value || typeof value !== 'object') return;
    if (depth > 16 || seen.has(value)) fail();
    seen.add(value);
    try {
      const prototype = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) fail();
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || BLOCKED.has(key)) fail();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail();
        assertData(descriptor.value, depth + 1, seen);
      }
    } finally { seen.delete(value); }
  }
  function reviewed(value, now) { return { value: text(value), humanReviewed: true, editedAt: now }; }
  function context(value) {
    if (typeof value === 'string') return { summary: text(value) };
    const raw = record(value), result = {};
    for (const key of CONTEXT_KEYS) if (text(raw[key])) result[key] = text(raw[key]);
    return result;
  }
  function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
  function types(value) { const raw = list(value, 3); return TYPES.filter(type => raw.includes(type)); }
  function legacyTypes(reference) {
    return reference.evidenceClass === 'sufficiency' ? ['sufficient']
      : reference.evidenceClass === 'necessity' ? ['necessary'] : [];
  }
  function legacyKey(reference) { return `${reference.edgeId}\u0000${reference.figureId}\u0000${reference.panelId}`; }
  function mechanismCanvasLegacyEvidenceId(edgeId, rawReference) {
    const reference = record(rawReference), identity = [edgeId, reference.figureId || '', reference.panelId || ''];
    // Historical unresolved text has no Figure/Panel identity, so its literal
    // label distinguishes it without ever guessing an actual source block.
    if (!reference.figureId || !reference.panelId) identity.push(text(reference.value, 4000));
    return `legacy-ref-${fingerprint(identity)}${fingerprint(['identity', ...identity])}`;
  }
  function storyBindingOwners(chain, wholeBindings) {
    const owners = new Map(list(wholeBindings, MAX_BINDINGS).map(binding => [record(binding).id, record(binding)]));
    for (const rawEdge of list(record(chain).edges, MAX_EDGES)) {
      const edge = record(rawEdge);
      for (const rawReference of list(edge.panelEvidence, 32)) owners.set(mechanismCanvasLegacyEvidenceId(edge.id, rawReference), { edgeId: edge.id });
    }
    return owners;
  }
  function requireTypes(value) {
    if (!Array.isArray(value) || value.length > 3 || value.some(type => !TYPES.includes(type)) || new Set(value).size !== value.length) fail();
    return types(value);
  }
  function fingerprint(value) {
    let hash = 2166136261;
    for (const character of JSON.stringify(value)) {
      hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function panelLabel(figure, panels) {
    const label = text(figure.figureLabel || figure.label, 240);
    const number = label.match(/(?:Figure|Fig\.?|图)\s*(S?\d+)/i)?.[1] ||
      id(figure.figureId || figure.id).match(/^figure-(S?\d+)$/i)?.[1] || '';
    const prefix = figure.isSupplemental && number && !/^S/i.test(number) ? `S${number}` : number;
    const sorted = [...panels];
    if (sorted.every(value => /^[A-Z]$/.test(value))) sorted.sort();
    const output = [];
    for (let i = 0; i < sorted.length; i++) {
      const first = sorted[i]; let last = first;
      while (/^[A-Z]$/.test(last) && /^[A-Z]$/.test(sorted[i + 1] || '') && sorted[i + 1].charCodeAt(0) === last.charCodeAt(0) + 1) last = sorted[++i];
      output.push(first === last ? `${prefix}${first}` : `${prefix}${first}-${prefix}${last}`);
    }
    return output.join('、');
  }
  function mechanismCanvasSources(rawFigures) {
    const entries = Array.isArray(rawFigures) ? list(rawFigures, 128) : Object.values(record(rawFigures));
    const result = [];
    for (const raw of entries) {
      const figure = record(raw), figureId = id(figure.figureId || figure.id);
      if (!figureId) continue;
      const panels = record(figure.panels);
      for (const rawBlock of list(figure.evidenceBlocks, 64)) {
        const block = record(rawBlock), blockId = id(block.id, 80), panelIds = ids(block.panelIds, 32);
        if (!blockId || !panelIds.length || block.kind === 'transition' || block.sourceType === 'bridge') continue;
        if (!panelIds.every(panelId => Object.hasOwn(panels, panelId))) continue;
        const selectedPanels = panelIds.map(panelId => record(panels[panelId]));
        const isManual = block.provenance === 'manual';
        const title = isManual ? text(block.title)
          : text(block.groupConclusion) || text(block.established) || text(block.groupGoal) || text(block.title) || '证据块';
        const source = {
          id: `${figureId}::${blockId}`, figureId, blockId, panelIds,
          figureLabel: text(figure.figureLabel || figure.label, 240), isSupplemental: figure.isSupplemental === true,
          panelLabel: panelLabel(figure, panelIds), title,
          method: isManual ? text(block.method) : text(block.method) || selectedPanels.map(panel => text(panel.experimentalMethods)).filter(Boolean).join('；'),
          observation: isManual ? text(block.observation) : text(block.observation) || selectedPanels.map(panel => text(panel.directObservation)).filter(Boolean).join('；'),
          conclusion: isManual ? text(block.conclusion) : text(block.groupConclusion) || text(block.established) || text(block.groupGoal),
          ...(isManual ? { provenance: 'manual' } : {}),
          ...(isManual && block.originalSourceType ? { originalSourceType: text(block.originalSourceType, 80),
            originalPanelIds: ids(block.originalPanelIds, 32), originalSource: {
              kind: text(record(block.originalSource).kind, 80), sourceType: text(block.originalSourceType, 80),
              panelIds: ids(block.originalPanelIds, 32),
              ...Object.fromEntries(['groupGoal', 'groupConclusion', 'upstreamContext', 'established', 'handoff',
                'evidenceLevel', 'transitionToNext', 'fromGroup', 'toGroup', 'nextGoal', 'relationType']
                .map(field => [field, text(record(block.originalSource)[field])]))
            } } : {}),
          sourceType: text(block.sourceType, 80)
        };
        source.sourceFingerprint = fingerprint([figureId, blockId, isManual ? text(block.originalSourceType, 80) || source.sourceType : source.sourceType, [...panelIds].sort()]);
        const panelSemantics = selectedPanels.map(panel => ['purpose', 'evidenceType', 'directObservation',
          'experimentalMethods', 'statisticalMethods', 'comparison', 'note', 'phenotypeName',
          'design', 'localInference', 'contribution'].map(field => text(panel[field])));
        const blockSemantics = (isManual ? ['kind', 'title', 'method', 'observation', 'conclusion']
          : ['kind', 'sourceType', 'groupGoal', 'groupConclusion', 'upstreamContext',
            'established', 'handoff', 'evidenceLevel', 'transitionToNext', 'title', 'method', 'observation', 'conclusion']).map(field => text(block[field]));
        source.contentFingerprint = fingerprint([source.title, source.method, source.observation,
          source.conclusion, panelSemantics, blockSemantics]);
        result.push(source);
      }
    }
    return result;
  }
  function mechanismCanvasArchive(rawFigures) {
    const entries = Array.isArray(rawFigures) ? list(rawFigures, 128) : Object.values(record(rawFigures));
    const result = [];
    for (const raw of entries) {
      const figure = record(raw);
      for (const rawEntry of list(figure.manualEvidenceArchive, 64)) {
        const entry = record(rawEntry), block = record(entry.block);
        if (!id(entry.id, 80) || block.id !== entry.blockId) continue;
        const source = mechanismCanvasSources([{ ...figure, evidenceBlocks: [block], panels: record(entry.panels) }])[0];
        if (!source) continue;
        result.push({ ...source, sourceId: source.id, id: entry.id, archiveId: entry.id,
          mergedIntoBlockId: id(entry.mergedIntoBlockId, 80), mergedAt: finite(entry.mergedAt, 0, 0, Number.MAX_SAFE_INTEGER) });
      }
    }
    return result;
  }
  function normalizeMechanismDrawing(value, options = {}) {
    if (value === undefined || value === null) return undefined;
    const raw = record(value), chain = record(options.chain);
    const nodeIds = new Set(list(chain.nodes, MAX_NODES).map(node => id(record(node).id)));
    const edgeIds = new Set(list(chain.edges, MAX_EDGES).map(edge => id(record(edge).id)));
    const positions = {};
    for (const [nodeId, item] of Object.entries(record(raw.positions)).slice(0, MAX_NODES)) {
      const point = record(item);
      if (!nodeIds.has(nodeId) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      positions[nodeId] = { x: finite(point.x), y: finite(point.y), ...(point.pinned === true ? { pinned: true } : {}) };
    }
    const viewport = record(raw.viewport), sources = mechanismCanvasSources(options.figures);
    const catalog = new Map(sources.map(source => [source.id, source]));
    const bindings = [], used = new Set(), pairs = new Set();
    for (const item of list(raw.bindings, MAX_BINDINGS)) {
      const binding = record(item), bindingId = id(binding.id, 80), edgeId = id(binding.edgeId, 80);
      const figureId = id(binding.figureId), blockId = id(binding.blockId, 80), panels = ids(binding.panelIds, 32);
      if (!bindingId || !edgeId || !figureId || !blockId || !panels.length || used.has(bindingId)) continue;
      const pair = `${edgeId}\u0000${figureId}\u0000${blockId}`;
      if (pairs.has(pair)) continue;
      used.add(bindingId); pairs.add(pair);
      const source = catalog.get(`${figureId}::${blockId}`);
      let reason = !edgeIds.has(edgeId) ? 'edge_missing' : '';
      if (options.figures !== undefined) {
        if (!source) reason = 'block_missing';
        else if (panels.length !== source.panelIds.length || panels.some(panel => !source.panelIds.includes(panel))) reason = 'panels_changed';
        else if (binding.sourceFingerprint && binding.sourceFingerprint !== source.sourceFingerprint) reason = 'block_changed';
      }
      // A once-stale binding must be explicitly replaced, never silently rebound.
      if (binding.unresolved === true && !reason) reason = text(binding.unresolvedReason, 80) || 'previously_unresolved';
      bindings.push({ id: bindingId, edgeId, figureId, blockId, panelIds: panels,
        types: types(binding.types), needsReview: binding.needsReview === true || Boolean(reason) ||
          Boolean(source && binding.contentFingerprint && binding.contentFingerprint !== source.contentFingerprint),
        ...(binding.sourceFingerprint ? { sourceFingerprint: text(binding.sourceFingerprint, 80) } : {}),
        ...(binding.contentFingerprint ? { contentFingerprint: text(binding.contentFingerprint, 80) } : {}),
        ...(reason ? { unresolved: true, unresolvedReason: reason } : {}) });
    }
    const edgeContexts = {};
    for (const [edgeId, rawContext] of Object.entries(record(raw.edgeContexts)).slice(0, MAX_EDGES)) {
      if (edgeIds.has(edgeId)) edgeContexts[edgeId] = context(rawContext);
    }
    const stages = [];
    for (const item of list(record(raw.story).stages, MAX_STAGES)) {
      const stage = record(item), stageId = id(stage.id, 80);
      if (!stageId || stages.some(candidate => candidate.id === stageId)) continue;
      const figureIds = Array.isArray(stage.figureIds) ? ids(stage.figureIds, 128) : undefined;
      const figureLabel = figureIds?.length && options.figures !== undefined
        ? figureIds.map(figureId => {
          const figure = Object.values(record(options.figures)).map(record).find(figure => figure.figureId === figureId);
          const label = text(figure?.figureLabel, 240), number = label.match(/(?:Figure|Fig\.?|图)\s*(S?\d+)/i)?.[1];
          return number ? `F${figure?.isSupplemental && !/^S/i.test(number) ? 'S' : ''}${number}` : label;
        }).filter(Boolean).join(' / ') : options.figures === undefined ? text(stage.figureLabel, 240) : '';
      stages.push({ id: stageId, title: text(stage.title, 240), summary: text(stage.summary),
        nodeIds: ids(stage.nodeIds), edgeIds: ids(stage.edgeIds || stage.relationIds),
        bindingIds: ids(stage.bindingIds, MAX_STORY_BINDINGS),
        ...(figureLabel ? { figureLabel } : {}), ...(figureIds ? { figureIds } : {}) });
    }
    const rawStory = record(raw.story), bindingIds = new Set(storyBindingOwners(chain, bindings).keys());
    const story = { stages };
    if (stages.length || ['baselineNodeIds', 'baselineEdgeIds', 'baselineBindingIds'].some(field => rawStory[field] !== undefined)) {
      for (const [field, known, maximum] of [['baselineNodeIds', nodeIds, MAX_NODES],
        ['baselineEdgeIds', edgeIds, MAX_EDGES], ['baselineBindingIds', bindingIds, MAX_STORY_BINDINGS]]) {
        story[field] = rawStory[field] === undefined ? [...known] : ids(rawStory[field], maximum).filter(member => known.has(member));
      }
    }
    const legacyEvidence = [], legacyKeys = new Set();
    for (const item of list(raw.legacyEvidence, MAX_BINDINGS)) {
      const judgment = record(item), edge = list(chain.edges, MAX_EDGES).map(record).find(edge => edge.id === judgment.edgeId);
      const key = legacyKey(judgment);
      if (legacyKeys.has(key) || !edge || !list(edge.panelEvidence, 32).some(rawReference => {
        const reference = record(rawReference);
        return reference.figureId === judgment.figureId && reference.panelId === judgment.panelId;
      })) continue;
      legacyKeys.add(key);
      legacyEvidence.push({ edgeId: judgment.edgeId, figureId: judgment.figureId, panelId: judgment.panelId,
        types: types(judgment.types), needsReview: judgment.needsReview === true });
    }
    return { schemaVersion: 1, positions,
      viewport: { x: finite(viewport.x), y: finite(viewport.y), zoom: finite(viewport.zoom, 1, .1, 4) },
      matrixHeight: finite(raw.matrixHeight, 198, 80, 800),
      mode: raw.mode === 'all' ? 'all' : 'main', activeStageId: id(raw.activeStageId, 80),
      bindings, edgeContexts, story, ...(legacyEvidence.length ? { legacyEvidence } : {}) };
  }
  function validateMechanismDrawing(value, options = {}) {
    const errors = [], raw = record(value), chain = record(options.chain);
    const nodes = new Set(list(chain.nodes, MAX_NODES).map(node => id(record(node).id)));
    const edges = new Map(list(chain.edges, MAX_EDGES).map(edge => [id(record(edge).id), record(edge)]));
    const bindings = new Map(), pairs = new Set();
    if (raw.schemaVersion !== 1 || Object.keys(raw).some(key => !DRAWING_KEYS.includes(key))) errors.push('drawing: invalid schema');
    if (!Array.isArray(raw.bindings) || raw.bindings.length > MAX_BINDINGS) errors.push('drawing.bindings: invalid collection');
    for (const binding of list(raw.bindings, MAX_BINDINGS)) {
      const row = record(binding), key = `${row.edgeId}\u0000${row.figureId}\u0000${row.blockId}`;
      if (typeof row.id !== 'string' || !id(row.id, 80) || row.id.startsWith('legacy-ref-') || bindings.has(row.id) || pairs.has(key)) errors.push('drawing.bindings: duplicate or invalid identity');
      bindings.set(row.id, row); pairs.add(key);
      if (!edges.has(row.edgeId) && row.unresolved !== true) errors.push('drawing.bindings: missing edge');
      if (!id(row.figureId) || !id(row.blockId, 80) || !Array.isArray(row.panelIds) || !row.panelIds.length || ids(row.panelIds, 32).length !== row.panelIds.length) errors.push('drawing.bindings: invalid source identity');
      try { requireTypes(row.types); } catch (_) { errors.push('drawing.bindings: invalid types'); }
      if (typeof row.needsReview !== 'boolean') errors.push('drawing.bindings: invalid review marker');
    }
    const stageIds = new Set(), allBindings = storyBindingOwners(chain, raw.bindings);
    for (const [field, known, maximum] of [['baselineNodeIds', nodes, MAX_NODES],
      ['baselineEdgeIds', edges, MAX_EDGES], ['baselineBindingIds', allBindings, MAX_STORY_BINDINGS]]) {
      const members = record(raw.story)[field];
      if (members !== undefined && (!Array.isArray(members) || members.length > maximum ||
          new Set(list(members, maximum)).size !== members.length || list(members, maximum).some(member => !known.has(member)))) errors.push(`drawing.story: invalid ${field}`);
    }
    const legacyKeys = new Set();
    if (raw.legacyEvidence !== undefined && (!Array.isArray(raw.legacyEvidence) || raw.legacyEvidence.length > MAX_BINDINGS)) errors.push('drawing.legacyEvidence: invalid collection');
    for (const item of list(raw.legacyEvidence, MAX_BINDINGS)) {
      const judgment = record(item), key = legacyKey(judgment), owner = edges.get(judgment.edgeId);
      if (legacyKeys.has(key) || !owner || !list(owner.panelEvidence, 32).some(rawReference => {
        const reference = record(rawReference);
        return reference.figureId === judgment.figureId && reference.panelId === judgment.panelId;
      })) errors.push('drawing.legacyEvidence: invalid identity');
      legacyKeys.add(key);
      try { requireTypes(judgment.types); } catch (_) { errors.push('drawing.legacyEvidence: invalid types'); }
      if (typeof judgment.needsReview !== 'boolean') errors.push('drawing.legacyEvidence: invalid review marker');
    }
    if (!raw.story || !Array.isArray(record(raw.story).stages) || record(raw.story).stages.length > MAX_STAGES) errors.push('drawing.story: invalid stages');
    for (const stage of list(record(raw.story).stages, MAX_STAGES)) {
      const row = record(stage), visibleNodes = new Set(list(row.nodeIds)), visibleEdges = new Set(list(row.edgeIds));
      if (!id(row.id, 80) || stageIds.has(row.id)) errors.push('drawing.story: duplicate or invalid stage id');
      stageIds.add(row.id);
      for (const [field, known] of [['nodeIds', nodes], ['edgeIds', edges], ['bindingIds', allBindings]]) {
        const members = list(row[field], MAX_STORY_BINDINGS);
        if (!Array.isArray(row[field]) || members.length !== row[field].length || new Set(members).size !== members.length || members.some(member => !known.has(member))) errors.push(`drawing.story: invalid ${field}`);
      }
      for (const edgeId of visibleEdges) {
        const edge = edges.get(edgeId);
        if (edge && (!visibleNodes.has(edge.from) || !visibleNodes.has(edge.to))) errors.push('drawing.story: visible edge needs both endpoints');
      }
      for (const bindingId of list(row.bindingIds, MAX_STORY_BINDINGS)) {
        if (allBindings.has(bindingId) && !visibleEdges.has(allBindings.get(bindingId).edgeId)) errors.push('drawing.story: visible binding needs owner edge');
      }
      if (row.figureIds !== undefined) {
        const figureIds = list(row.figureIds, 128);
        const knownFigures = new Set(Object.values(record(options.figures)).map(figure => record(figure).figureId));
        if (!Array.isArray(row.figureIds) || figureIds.length !== row.figureIds.length || ids(row.figureIds, 128).length !== figureIds.length ||
            (options.figures !== undefined && figureIds.some(figureId => !knownFigures.has(figureId)))) errors.push('drawing.story: invalid figureIds');
      }
    }
    if (raw.activeStageId && !stageIds.has(raw.activeStageId)) errors.push('drawing.activeStageId: unknown stage');
    for (const [nodeId, rawPoint] of Object.entries(record(raw.positions))) {
      const point = record(rawPoint);
      if (!nodes.has(nodeId) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) errors.push('drawing.positions: invalid node or coordinates');
    }
    for (const edgeId of Object.keys(record(raw.edgeContexts))) if (!edges.has(edgeId)) errors.push('drawing.edgeContexts: unknown edge');
    return errors;
  }
  function readMechanismDrawing(value, options = {}) {
    assertData(value);
    if (validateMechanismDrawing(value, options).length) fail();
    const normalized = normalizeMechanismDrawing(value, options);
    // Reject exotic/accessor properties and unknown nested fields without evaluating them.
    function plain(raw, safe) {
      if (raw === safe) return true;
      if (!raw || !safe || typeof raw !== 'object' || typeof safe !== 'object') return false;
      try {
        const keys = Reflect.ownKeys(raw), safeKeys = Reflect.ownKeys(safe);
        if (keys.length !== safeKeys.length || keys.some(key => !safeKeys.includes(key))) return false;
        for (const key of keys) {
          const descriptor = Object.getOwnPropertyDescriptor(raw, key);
          if (!descriptor || !Object.hasOwn(descriptor, 'value') || !plain(descriptor.value, safe[key])) return false;
        }
        return true;
      } catch (_) { return false; }
    }
    if (!plain(value, normalized)) fail();
    return normalized;
  }
  function getMechanismCanvasSnapshot(chain) {
    const value = record(chain);
    return clone({ nodes: value.nodes || [], edges: value.edges || [],
      ...(value.drawing ? { drawing: value.drawing } : {}), initialized: value.initialized === true });
  }
  function reconcileMechanismCanvasDrawing(before, next, options = {}) {
    if (!next.drawing && !before.drawing) return next;
    const drawing = normalizeMechanismDrawing(next.drawing || before.drawing,
      { chain: next, figures: options.figures });
    const nodes = new Map(next.nodes.map(node => [node.id, node]));
    const edges = new Map(next.edges.map(edge => [edge.id, edge]));
    const oldNodes = new Map(before.nodes.map(node => [node.id, node]));
    const oldEdges = new Map(before.edges.map(edge => [edge.id, edge]));
    const semantics = (edge, nodeMap) => edge && [edge.from, edge.to, text(edge.label), edge.polarity,
      text(nodeMap.get(edge.from)?.label), text(nodeMap.get(edge.to)?.label)];
    drawing.bindings.forEach(binding => {
      if (!same(semantics(oldEdges.get(binding.edgeId), oldNodes), semantics(edges.get(binding.edgeId), nodes))) binding.needsReview = true;
    });
    for (const edge of next.edges) {
      if (!same(semantics(oldEdges.get(edge.id), oldNodes), semantics(edge, nodes))) markLegacyReview(drawing, edge);
    }
    for (const stage of drawing.story.stages) {
      stage.nodeIds = stage.nodeIds.filter(nodeId => nodes.has(nodeId));
      stage.edgeIds = stage.edgeIds.filter(edgeId => edges.has(edgeId) &&
        stage.nodeIds.includes(edges.get(edgeId).from) && stage.nodeIds.includes(edges.get(edgeId).to));
      const bindings = storyBindingOwners(next, drawing.bindings);
      stage.bindingIds = stage.bindingIds.filter(bindingId => bindings.has(bindingId) && stage.edgeIds.includes(bindings.get(bindingId).edgeId));
    }
    return { ...next, drawing };
  }
  function markLegacyReview(drawing, edge) {
    for (const reference of edge.panelEvidence || []) {
      drawing.legacyEvidence ||= [];
      let judgment = drawing.legacyEvidence.find(item => item.edgeId === edge.id &&
        item.figureId === reference.figureId && item.panelId === reference.panelId);
      if (!judgment) {
        judgment = { edgeId: edge.id, figureId: reference.figureId, panelId: reference.panelId,
          types: legacyTypes(reference), needsReview: true };
        drawing.legacyEvidence.push(judgment);
      }
      judgment.needsReview = true; reference.humanReviewed = false;
    }
  }
  function applyMechanismCanvasCommand(chain, rawCommand, options = {}) {
    assertData(rawCommand);
    const command = record(rawCommand), now = Math.max(0, Math.trunc(options.now ?? Date.now()));
    const next = clone(chain), node = nodeId => next.nodes.find(item => item.id === nodeId), edge = edgeId => next.edges.find(item => item.id === edgeId);
    next.drawing = normalizeMechanismDrawing(next.drawing || {}, { chain: next, figures: options.figures });
    const drawing = next.drawing, sourceById = new Map(mechanismCanvasSources(options.figures).map(source => [source.id, source]));
    function requireNode(nodeId) { const value = node(nodeId); if (!value) fail('FIGURE_WORKSPACE_TARGET_NOT_FOUND'); return value; }
    function requireEdge(edgeId) { const value = edge(edgeId); if (!value) fail('FIGURE_WORKSPACE_TARGET_NOT_FOUND'); return value; }
    function requireBinding(bindingId) { const value = drawing.bindings.find(binding => binding.id === bindingId); if (!value) fail('FIGURE_WORKSPACE_TARGET_NOT_FOUND'); return value; }
    function markReview(edgeIds) {
      drawing.bindings.forEach(binding => { if (edgeIds.includes(binding.edgeId)) binding.needsReview = true; });
      next.edges.filter(edge => edgeIds.includes(edge.id)).forEach(edge => markLegacyReview(drawing, edge));
    }
    function pruneStory() {
      const nodes = new Set(next.nodes.map(item => item.id)), edges = new Set(next.edges.map(item => item.id)), owners = storyBindingOwners(next, drawing.bindings), bindings = new Set(owners.keys());
      for (const stage of drawing.story.stages) {
        stage.nodeIds = stage.nodeIds.filter(value => nodes.has(value));
        stage.edgeIds = stage.edgeIds.filter(value => edges.has(value) && stage.nodeIds.includes(edge(value).from) && stage.nodeIds.includes(edge(value).to));
        stage.bindingIds = stage.bindingIds.filter(value => bindings.has(value) && stage.edgeIds.includes(owners.get(value).edgeId));
      }
      for (const nodeId of Object.keys(drawing.positions)) if (!nodes.has(nodeId)) delete drawing.positions[nodeId];
      for (const edgeId of Object.keys(drawing.edgeContexts)) if (!edges.has(edgeId)) delete drawing.edgeContexts[edgeId];
      for (const [field, known] of [['baselineNodeIds', nodes], ['baselineEdgeIds', edges], ['baselineBindingIds', bindings]]) {
        if (drawing.story[field]) drawing.story[field] = drawing.story[field].filter(value => known.has(value));
      }
      if (drawing.legacyEvidence) drawing.legacyEvidence = drawing.legacyEvidence.filter(judgment => edges.has(judgment.edgeId) &&
        edge(judgment.edgeId).panelEvidence.some(reference => reference.figureId === judgment.figureId && reference.panelId === judgment.panelId));
    }
    function sourceBinding(raw, bindingId) {
      const row = record(raw), edgeId = id(row.edgeId, 80), figureId = id(row.figureId), blockId = id(row.blockId, 80);
      if (edgeId !== row.edgeId || figureId !== row.figureId || blockId !== row.blockId) fail();
      requireEdge(edgeId);
      const source = sourceById.get(`${figureId}::${blockId}`);
      if (!source) fail('FIGURE_WORKSPACE_PANEL_CONTEXT_STALE');
      const panels = row.panelIds === undefined ? source.panelIds.slice() : ids(row.panelIds, 32);
      if (panels.length !== source.panelIds.length || panels.some(panelId => !source.panelIds.includes(panelId))) fail('FIGURE_WORKSPACE_PANEL_CONTEXT_STALE');
      return { id: bindingId, edgeId, figureId, blockId, panelIds: panels,
        types: row.types === undefined ? [] : requireTypes(row.types), needsReview: false,
        sourceFingerprint: source.sourceFingerprint, contentFingerprint: source.contentFingerprint };
    }
    switch (command.type) {
      case 'add_node': {
        const raw = record(command.node), nodeId = id(raw.id, 80);
        if (!nodeId || nodeId !== raw.id || node(nodeId) || next.nodes.length >= MAX_NODES || !nodeText(raw.label)) fail();
        next.nodes.push({ id: nodeId, label: { ...reviewed(raw.label, now), value: nodeText(raw.label) } });
        if (command.position) drawing.positions[nodeId] = { x: finite(record(command.position).x), y: finite(record(command.position).y) };
        break;
      }
      case 'move_nodes':
        if (!Array.isArray(command.positions) || command.positions.length > MAX_NODES) fail();
        for (const item of command.positions) {
          const point = record(item); requireNode(point.nodeId);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) fail();
          drawing.positions[point.nodeId] = { x: finite(point.x), y: finite(point.y), ...(point.pinned === true ? { pinned: true } : {}) };
        }
        break;
      case 'update_node': {
        const value = requireNode(command.nodeId); if (!nodeText(command.label)) fail();
        if (nodeText(value.label) !== nodeText(command.label)) {
          value.label = { ...reviewed(command.label, now), value: nodeText(command.label) };
          markReview(next.edges.filter(item => item.from === value.id || item.to === value.id).map(item => item.id));
        }
        break;
      }
      case 'add_edge': {
        const raw = record(command.edge), edgeId = id(raw.id, 80); requireNode(raw.from); requireNode(raw.to);
        if (!edgeId || edgeId !== raw.id || edge(edgeId) || next.edges.length >= MAX_EDGES || !['neutral', 'positive', 'negative'].includes(raw.polarity || 'neutral') || (raw.from === raw.to && (!raw.polarity || raw.polarity === 'neutral'))) fail();
        const edgeContext = context(raw.context);
        if (next.edges.some(item => item.from === raw.from && item.to === raw.to && item.polarity === (raw.polarity || 'neutral') && text(item.label) === text(raw.label) && same(drawing.edgeContexts[item.id] || {}, edgeContext))) fail('FIGURE_WORKSPACE_DUPLICATE_ID');
        next.edges.push({ id: edgeId, from: raw.from, to: raw.to, label: reviewed(raw.label, now), polarity: raw.polarity || 'neutral', panelEvidence: [], humanReviewed: true, editedAt: now });
        if (Object.keys(edgeContext).length) drawing.edgeContexts[edgeId] = edgeContext;
        break;
      }
      case 'update_edge': {
        const value = requireEdge(command.edgeId), before = clone(value), beforeContext = drawing.edgeContexts[value.id] || {};
        for (const field of ['from', 'to']) if (command[field] !== undefined) { requireNode(command[field]); value[field] = command[field]; }
        if (command.label !== undefined) value.label = reviewed(command.label, now);
        if (command.polarity !== undefined) { if (!['neutral', 'positive', 'negative'].includes(command.polarity)) fail(); value.polarity = command.polarity; }
        if (value.from === value.to && value.polarity === 'neutral') fail();
        if (command.context !== undefined) drawing.edgeContexts[value.id] = context(command.context);
        if (!same(before, value) || !same(beforeContext, drawing.edgeContexts[value.id] || {})) { value.humanReviewed = true; value.editedAt = now; markReview([value.id]); }
        pruneStory(); break;
      }
      case 'remove_nodes': {
        const removed = ids(command.nodeIds); if (!removed.length) fail(); removed.forEach(requireNode);
        next.nodes = next.nodes.filter(item => !removed.includes(item.id));
        next.edges = next.edges.filter(item => !removed.includes(item.from) && !removed.includes(item.to));
        drawing.bindings = drawing.bindings.filter(binding => edge(binding.edgeId));
        pruneStory(); break;
      }
      case 'remove_edge':
        requireEdge(command.edgeId); next.edges = next.edges.filter(item => item.id !== command.edgeId);
        drawing.bindings = drawing.bindings.filter(binding => binding.edgeId !== command.edgeId); pruneStory(); break;
      case 'bind_block': {
        const raw = record(command.binding), bindingId = id(raw.id, 80);
        if (!bindingId || bindingId.startsWith('legacy-ref-') || bindingId !== raw.id || drawing.bindings.some(binding => binding.id === bindingId) || drawing.bindings.length >= MAX_BINDINGS) fail();
        const binding = sourceBinding(raw, bindingId);
        if (drawing.bindings.some(item => item.edgeId === binding.edgeId && item.figureId === binding.figureId && item.blockId === binding.blockId)) fail('FIGURE_WORKSPACE_DUPLICATE_ID');
        drawing.bindings.push(binding); break;
      }
      case 'set_binding_types': {
        const binding = requireBinding(command.bindingId); if (binding.unresolved) fail('FIGURE_WORKSPACE_PANEL_CONTEXT_STALE');
        binding.types = requireTypes(command.types); binding.needsReview = false;
        const source = sourceById.get(`${binding.figureId}::${binding.blockId}`);
        if (source) binding.contentFingerprint = source.contentFingerprint;
        break;
      }
      case 'remove_binding':
        requireBinding(command.bindingId); drawing.bindings = drawing.bindings.filter(binding => binding.id !== command.bindingId); pruneStory(); break;
      case 'replace_binding': {
        const current = requireBinding(command.bindingId);
        const replacement = sourceBinding({ ...command, edgeId: current.edgeId, types: [] }, current.id);
        if (drawing.bindings.some(binding => binding.id !== current.id && binding.edgeId === replacement.edgeId && binding.figureId === replacement.figureId && binding.blockId === replacement.blockId)) fail('FIGURE_WORKSPACE_DUPLICATE_ID');
        Object.keys(current).forEach(key => delete current[key]); Object.assign(current, replacement); break;
      }
      case 'set_legacy_evidence_types':
      case 'remove_legacy_evidence': {
        const owner = requireEdge(command.edgeId);
        const reference = Number.isInteger(command.index) && command.index >= 0 ? owner.panelEvidence[command.index] : null;
        if (!reference || reference.figureId !== command.figureId || reference.panelId !== command.panelId) fail('FIGURE_WORKSPACE_PANEL_CONTEXT_STALE');
        if (command.type === 'remove_legacy_evidence') {
          const virtualId = mechanismCanvasLegacyEvidenceId(owner.id, reference);
          owner.panelEvidence = owner.panelEvidence.filter(item => mechanismCanvasLegacyEvidenceId(owner.id, item) !== virtualId);
          pruneStory(); break;
        }
        const selectedTypes = requireTypes(command.types);
        drawing.legacyEvidence ||= [];
        const key = legacyKey({ edgeId: owner.id, figureId: reference.figureId, panelId: reference.panelId });
        drawing.legacyEvidence = drawing.legacyEvidence.filter(item => legacyKey(item) !== key);
        drawing.legacyEvidence.push({ edgeId: owner.id, figureId: reference.figureId, panelId: reference.panelId, types: selectedTypes, needsReview: false });
        if (selectedTypes.length === 1) {
          reference.evidenceClass = selectedTypes[0] === 'sufficient' ? 'sufficiency' : selectedTypes[0] === 'necessary' ? 'necessity' : 'other';
          reference.evidenceClassSource = 'manual';
        } else { delete reference.evidenceClass; delete reference.evidenceClassSource; }
        reference.humanReviewed = true; reference.editedAt = now;
        break;
      }
      case 'set_view':
        if (command.viewport !== undefined) drawing.viewport = { x: finite(record(command.viewport).x), y: finite(record(command.viewport).y), zoom: finite(record(command.viewport).zoom, 1, .1, 4) };
        if (command.matrixHeight !== undefined) drawing.matrixHeight = finite(command.matrixHeight, 198, 80, 800);
        if (command.mode !== undefined) { if (!['main', 'all'].includes(command.mode)) fail(); drawing.mode = command.mode; }
        if (command.activeStageId !== undefined) drawing.activeStageId = id(command.activeStageId, 80);
        break;
      case 'set_story': {
        const previousStory = drawing.story;
        drawing.story = clone(command.story);
        for (const field of ['baselineNodeIds', 'baselineEdgeIds', 'baselineBindingIds']) {
          if (drawing.story[field] === undefined && previousStory[field]) drawing.story[field] = previousStory[field];
        }
        if (drawing.activeStageId && !list(record(drawing.story).stages).some(stage => record(stage).id === drawing.activeStageId)) drawing.activeStageId = '';
        break;
      }
      case 'restore_snapshot': {
        const snapshot = record(command.snapshot);
        if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges) || snapshot.nodes.length > MAX_NODES || snapshot.edges.length > MAX_EDGES) fail();
        next.nodes = clone(snapshot.nodes); next.edges = clone(snapshot.edges);
        next.initialized = snapshot.initialized === true;
        const restored = normalizeMechanismDrawing(snapshot.drawing || {}, { chain: next, figures: options.figures });
        next.drawing = { ...restored, viewport: drawing.viewport, mode: drawing.mode,
          activeStageId: drawing.activeStageId, matrixHeight: drawing.matrixHeight };
        if (next.drawing.activeStageId && !next.drawing.story.stages.some(stage => stage.id === next.drawing.activeStageId)) next.drawing.activeStageId = '';
        break;
      }
      default: fail('FIGURE_WORKSPACE_CANVAS_COMMAND_UNKNOWN');
    }
    // Manual empty drawings remain initialized and cannot be auto-reseeded.
    next.initialized = true;
    const graphSignature = (item, drawing) => JSON.stringify([item.from, item.to, item.polarity, text(item.label), drawing?.edgeContexts?.[item.id] || {}]);
    const priorSignatures = new Map((chain.edges || []).map(item => [item.id, graphSignature(item, chain.drawing)]));
    const nodeIds = new Set(), edgeIds = new Set(), signatures = new Map();
    for (const item of next.nodes) {
      if (!id(item.id, 80) || nodeIds.has(item.id) || !text(item.label)) fail();
      nodeIds.add(item.id);
    }
    for (const item of next.edges) {
      if (!id(item.id, 80) || edgeIds.has(item.id) || !nodeIds.has(item.from) || !nodeIds.has(item.to) ||
          !['neutral', 'positive', 'negative'].includes(item.polarity) ||
          (item.from === item.to && item.polarity === 'neutral') || !Array.isArray(item.panelEvidence)) fail();
      edgeIds.add(item.id);
      const signature = graphSignature(item, next.drawing), previousId = signatures.get(signature);
      // Audited legacy generation can contain parallel rows whose distinct
      // contexts live in its provenance envelope. Preserve unchanged rows.
      if (previousId && (priorSignatures.get(item.id) !== signature || priorSignatures.get(previousId) !== signature)) fail('FIGURE_WORKSPACE_DUPLICATE_ID');
      signatures.set(signature, item.id);
    }
    if (next.drawing) {
      const normalized = normalizeMechanismDrawing(next.drawing, { chain: next, figures: options.figures });
      if (validateMechanismDrawing(next.drawing, { chain: next, figures: options.figures }).length) fail();
      next.drawing = normalized;
    }
    return next;
  }
  function createMechanismCanvasView(draft, options = {}) {
    const rawDraft = record(draft), chain = record(rawDraft.mechanismChain || rawDraft.chain || rawDraft);
    const figures = rawDraft.figures === undefined ? options.figures : rawDraft.figures;
    const sources = mechanismCanvasSources(figures);
    const catalog = new Map(sources.map(source => [source.id, source]));
    const figureCatalog = new Map((Array.isArray(figures) ? list(figures, 128) : Object.values(record(figures)))
      .map(rawFigure => { const figure = record(rawFigure); return [figure.figureId || figure.id, figure]; }));
    const drawing = normalizeMechanismDrawing(chain.drawing || {}, { chain, figures });
    const generatedContexts = mechanismCanvasVerifiedContexts(draft);
    const nodes = list(chain.nodes, MAX_NODES).map((raw, index) => {
      const node = record(raw), position = drawing.positions[node.id];
      return { id: node.id, label: nodeText(node.label), ...(position || { x: 80 + (index % 4) * 230, y: 80 + Math.floor(index / 4) * 150 }), pinned: position?.pinned === true };
    });
    const edges = list(chain.edges, MAX_EDGES).map(raw => {
      const edge = record(raw);
      const evidence = drawing.bindings.filter(binding => binding.edgeId === edge.id).map(binding => {
        const source = catalog.get(`${binding.figureId}::${binding.blockId}`);
        const figure = source || figureCatalog.get(binding.figureId);
        return { ...binding, panelLabel: figure ? panelLabel(figure, binding.panelIds) : binding.panelIds.join('、') };
      });
      // Legacy individual Panel references are retained as individual references.
      for (const [index, rawReference] of list(edge.panelEvidence, 32).entries()) {
        const reference = record(rawReference);
        const judgment = drawing.legacyEvidence?.find(item => item.edgeId === edge.id && item.figureId === reference.figureId && item.panelId === reference.panelId);
        const virtualId = mechanismCanvasLegacyEvidenceId(edge.id, reference), selectedTypes = judgment?.types || legacyTypes(reference);
        const prior = evidence.find(item => item.legacy && item.id === virtualId);
        if (prior) { prior.types = types([...prior.types, ...selectedTypes]); prior.unresolved ||= reference.unresolved === true; continue; }
        evidence.push({ id: virtualId, edgeId: edge.id, index, figureId: reference.figureId, blockId: '', panelIds: [reference.panelId], panelLabel: text(reference.value, 80), types: selectedTypes, needsReview: judgment?.needsReview === true, legacy: true, unresolved: reference.unresolved === true });
      }
      return { id: edge.id, from: edge.from, to: edge.to, label: text(edge.label), polarity: edge.polarity || 'neutral', context: drawing.edgeContexts[edge.id] || generatedContexts[edge.id] || {}, evidence };
    });
    const nodeIds = nodes.map(node => node.id), cells = nodeIds.map(target => nodeIds.map(source => edges.filter(edge => edge.from === source && edge.to === target)));
    const snapshot = getMechanismCanvasSnapshot(chain);
    if (Object.keys(generatedContexts).length) snapshot.drawing = { ...drawing,
      edgeContexts: { ...generatedContexts, ...drawing.edgeContexts } };
    return { revision: Number.isSafeInteger(rawDraft.revision) ? rawDraft.revision : 0,
      contextKey: JSON.stringify(record(rawDraft.binding)), nodes, edges, sources, evidenceArchive: mechanismCanvasArchive(figures), drawing,
      hasSavedViewport: Boolean(chain.drawing && Object.hasOwn(record(chain.drawing), 'viewport')),
      figures: Object.values(record(figures)).map(rawFigure => {
        const figure = record(rawFigure);
        return { figureId: figure.figureId, figureLabel: text(figure.figureLabel, 240), isSupplemental: figure.isSupplemental === true };
      }).filter(figure => id(figure.figureId)),
      story: drawing.story, matrix: { orientation: 'target_rows_source_columns', rowNodeIds: nodeIds, columnNodeIds: nodeIds, cells },
      snapshot };
  }
  function mechanismCanvasVerifiedContexts(draft) {
    const raw = record(draft), binding = record(raw.binding), chain = record(raw.mechanismChain);
    const readEnvelope = host.SciLLM?.readMechanismGenerationEnvelope;
    if (typeof readEnvelope !== 'function' || typeof raw.mechanismGeneration !== 'string') return {};
    let envelope;
    try { envelope = readEnvelope(raw.mechanismGeneration); } catch (_) { return {}; }
    if (!envelope || envelope.envelopeKind !== 'durable' || envelope.identity.documentId !== binding.documentId ||
        envelope.identity.workspaceId !== binding.workspaceId || envelope.identity.workspaceGeneration !== binding.workspaceGeneration) return {};
    const edges = new Map(list(chain.edges, MAX_EDGES).map(item => [record(item).id, record(item)])), result = {};
    for (const relation of envelope.preview.relations) {
      const edge = edges.get(relation.relationId);
      const polarity = relation.polarity === 'increases' ? 'positive' : relation.polarity === 'decreases' ? 'negative' : 'neutral';
      if (relation.renderable && edge && edge.from === relation.sourceNodeId && edge.to === relation.targetNodeId && edge.polarity === polarity) result[edge.id] = context(relation.context);
    }
    return result;
  }
  function mechanismCanvasCommandIsPresentation(command, chain, options = {}) {
    const raw = record(command);
    if (['move_nodes', 'set_view', 'set_story'].includes(raw.type)) return true;
    if (raw.type !== 'restore_snapshot' || !chain) return false;
    const snapshot = record(raw.snapshot);
    const fields = value => {
      const drawing = normalizeMechanismDrawing(value.drawing || {}, { chain: value });
      return { nodes: value.nodes, edges: value.edges, bindings: drawing.bindings,
        legacyEvidence: drawing.legacyEvidence || [],
        edgeContexts: { ...record(options.verifiedContexts), ...drawing.edgeContexts } };
    };
    return same(fields(record(chain)), fields(snapshot));
  }
  return { normalizeMechanismDrawing, validateMechanismDrawing, readMechanismDrawing,
    mechanismCanvasSources, mechanismCanvasArchive, createMechanismCanvasView, getMechanismCanvasSnapshot,
    applyMechanismCanvasCommand, mechanismCanvasCommandIsPresentation, reconcileMechanismCanvasDrawing,
    mechanismCanvasVerifiedContexts, mechanismCanvasLegacyEvidenceId };
});
