(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(host) {
  'use strict';

  const MAX_NODES = 64;
  const MAX_EDGES = 64;
  const MECHANISM_NETWORK_EXPORT_SCHEMA = 'brevess.mechanism-network';
  const MECHANISM_NETWORK_EXPORT_VERSION = 2;
  const MECHANISM_NETWORK_LEGACY_VERSION = 1;
  const MAX_MECHANISM_GENERATION_LENGTH = 750000;
  const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function ownDataProperty(value, key) {
    if (!value || typeof value !== 'object') {
      return { readable: false, present: false, value: undefined };
    }
    try {
      if (Array.isArray(value)) {
        return { readable: false, present: false, value: undefined };
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return { readable: false, present: false, value: undefined };
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return { readable: true, present: false, value: undefined };
      if (!Object.hasOwn(descriptor, 'value')) {
        return { readable: false, present: true, value: undefined };
      }
      return { readable: true, present: true, value: descriptor.value };
    } catch (_) {
      return { readable: false, present: false, value: undefined };
    }
  }

  function ownDataValue(value, key) {
    const property = ownDataProperty(value, key);
    return property.readable && property.present ? property.value : undefined;
  }

  function cappedDataArrayRead(value, maximum) {
    let length;
    try {
      if (!Array.isArray(value)) return { values: [], complete: false };
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      length = descriptor && Object.hasOwn(descriptor, 'value')
        ? descriptor.value : -1;
    } catch (_) {
      return { values: [], complete: false };
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      return { values: [], complete: false };
    }
    const values = [];
    let complete = length <= maximum;
    const limit = Math.min(length, maximum);
    for (let index = 0; index < limit; index += 1) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); }
      catch (_) {
        complete = false;
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        complete = false;
        continue;
      }
      values.push(descriptor.value);
    }
    return { values, complete };
  }

  function cappedDataArray(value, maximum) {
    return cappedDataArrayRead(value, maximum).values;
  }

  function ownCappedDataArray(owner, key, maximum) {
    const property = ownDataProperty(owner, key);
    if (!property.readable) return { values: [], complete: false };
    if (!property.present) return { values: [], complete: true };
    return cappedDataArrayRead(property.value, maximum);
  }

  function graphParts(chain) {
    const nodeRead = ownCappedDataArray(chain, 'nodes', MAX_NODES);
    const rawNodes = nodeRead.values;
    const nodes = [];
    const allowed = new Set();
    let locatorAuthority = nodeRead.complete;
    for (const node of rawNodes) {
      const idProperty = ownDataProperty(node, 'id');
      const id = idProperty.readable && idProperty.present ? idProperty.value : undefined;
      if (typeof id !== 'string' || !id) {
        locatorAuthority = false;
        continue;
      }
      if (allowed.has(id)) continue;
      allowed.add(id);
      nodes.push({ id, source: node });
    }
    const edgeRead = ownCappedDataArray(chain, 'edges', MAX_EDGES);
    const rawEdges = edgeRead.values;
    locatorAuthority = locatorAuthority && edgeRead.complete;
    const edges = [];
    for (const edge of rawEdges) {
      const idProperty = ownDataProperty(edge, 'id');
      const fromProperty = ownDataProperty(edge, 'from');
      const toProperty = ownDataProperty(edge, 'to');
      const id = idProperty.readable && idProperty.present ? idProperty.value : undefined;
      const from = fromProperty.readable && fromProperty.present ? fromProperty.value : undefined;
      const to = toProperty.readable && toProperty.present ? toProperty.value : undefined;
      if (typeof id !== 'string' || !id || typeof from !== 'string' ||
          typeof to !== 'string' || !allowed.has(from) || !allowed.has(to)) {
        locatorAuthority = false;
        continue;
      }
      edges.push({
        id,
        from,
        to,
        polarity: ownDataValue(edge, 'polarity') === 'positive' ||
          ownDataValue(edge, 'polarity') === 'negative'
          ? ownDataValue(edge, 'polarity') : 'neutral',
        source: edge
      });
    }
    return { nodes, nodeIds: nodes.map(node => node.id), edges, locatorAuthority };
  }

  function boundedDisplayText(value, maximum = 180) {
    return typeof value === 'string'
      ? value.normalize('NFC')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ').trim().slice(0, maximum)
      : '';
  }

  function mechanismNodeLabel(node, fallback) {
    const label = ownDataValue(node, 'label');
    return boundedDisplayText(ownDataValue(label, 'value'), 180) || fallback;
  }

  function createMechanismMermaidDefinition(chain, options = {}) {
    const graph = graphParts(chain);
    const isEnglish = String(options.language || '').toLowerCase().startsWith('en');
    const aliases = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
    const direction = String(options.direction || '').toUpperCase() === 'TD' ? 'TD' : 'LR';
    const lines = [`flowchart ${direction}`];
    graph.nodes.forEach((node, index) => {
      const fallback = isEnglish ? `Mechanism node ${index + 1}` : `机制节点 ${index + 1}`;
      const label = safeGraphLabel(mechanismNodeLabel(node.source, fallback), fallback)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/[\[\]{}]/g, character => `&#${character.codePointAt(0)};`);
      lines.push(`  ${aliases.get(node.id)}["${label}"]`);
    });
    graph.edges.forEach(edge => {
      const from = aliases.get(edge.from);
      const to = aliases.get(edge.to);
      if (!from || !to) return;
      lines.push(`  ${from} ${edge.polarity === 'negative' ? '-.->' : '-->'} ${to}`);
    });
    return lines.join('\n');
  }

  function panelAliasValue(chain, panelKey) {
    if (!panelKey) return '';
    const aliases = ownDataValue(chain, 'panelAliases');
    const alias = ownDataValue(aliases, panelKey);
    return boundedDisplayText(ownDataValue(alias, 'value'), 80);
  }

  function normalizeMatrixEvidence(chain, edgeSource, ownerEdgeId) {
    const evidence = cappedDataArray(ownDataValue(edgeSource, 'panelEvidence'), 64);
    const result = [];
    const seen = new Set();
    for (let evidenceIndex = 0; evidenceIndex < evidence.length; evidenceIndex += 1) {
      const item = evidence[evidenceIndex];
      const figureId = boundedDisplayText(ownDataValue(item, 'figureId'), 160);
      const panelId = boundedDisplayText(ownDataValue(item, 'panelId'), 80);
      const panelKey = figureId && panelId ? `${figureId}:${panelId}` : '';
      const originalDisplayId = boundedDisplayText(ownDataValue(item, 'value'), 80);
      const displayName = panelAliasValue(chain, panelKey) || originalDisplayId;
      const identity = panelKey || `display:${originalDisplayId}`;
      if (!displayName || seen.has(identity)) continue;
      seen.add(identity);
      const rawClass = ownDataValue(item, 'evidenceClass');
      result.push({
        panelKey,
        figureId,
        panelId,
        originalDisplayId,
        displayName,
        evidenceClass: rawClass === 'sufficiency' || rawClass === 'necessity'
          ? rawClass : 'other',
        ownerEdgeId: boundedDisplayText(ownerEdgeId, 160),
        edgeId: boundedDisplayText(ownerEdgeId, 160),
        evidenceIndex
      });
    }
    return result;
  }

  function chainMatrixRelationDescriptor(edge, ordinal) {
    const relationKind = ownDataValue(edge.source, 'relationKind') === 'correlative'
      ? 'correlative' : 'causal';
    const rawLabel = ownDataValue(edge.source, 'label');
    const label = boundedDisplayText(ownDataValue(rawLabel, 'value'), 180);
    return {
      id: edge.id,
      ordinal,
      polarity: edge.polarity,
      relationKind,
      contested: ownDataValue(edge.source, 'contested') === true,
      label,
      labelSource: label && ownDataValue(rawLabel, 'humanReviewed') !== false
        ? 'source' : 'generated'
    };
  }

  function createMechanismEvidenceMatrix(chain) {
    const graph = graphParts(chain);
    const nodes = graph.nodes.map((node, index) => ({
      id: node.id,
      label: mechanismNodeLabel(node.source, `Node ${index + 1}`)
    }));
    const byPair = new Map();
    const edgeIdsByPair = new Map();
    const relationDescriptorsByPair = new Map();
    graph.edges.forEach(edge => {
      const key = `${edge.from}\u0000${edge.to}`;
      const current = byPair.get(key) || [];
      const edgeIds = edgeIdsByPair.get(key) || [];
      const relationDescriptors = relationDescriptorsByPair.get(key) || [];
      if (!edgeIds.includes(edge.id)) {
        edgeIds.push(edge.id);
        relationDescriptors.push(chainMatrixRelationDescriptor(
          edge, relationDescriptors.length + 1
        ));
      }
      normalizeMatrixEvidence(chain, edge.source, edge.id)
        .forEach(item => current.push(item));
      byPair.set(key, current);
      edgeIdsByPair.set(key, edgeIds);
      relationDescriptorsByPair.set(key, relationDescriptors);
    });
    const cells = [];
    nodes.forEach(row => nodes.forEach(column => {
      cells.push({
        from: row.id,
        to: column.id,
        edgeIds: edgeIdsByPair.get(`${row.id}\u0000${column.id}`) || [],
        relationDescriptors:
          relationDescriptorsByPair.get(`${row.id}\u0000${column.id}`) || [],
        evidence: byPair.get(`${row.id}\u0000${column.id}`) || []
      });
    }));
    return { nodes, cells };
  }

  const EVIDENCE_CODE_ORDER = Object.freeze(['S', 'N', 'R', 'E', 'I', 'A', 'O', '0', 'C', '?']);
  const EVIDENCE_CODES = new Set(EVIDENCE_CODE_ORDER);

  function normalizeMechanismEvidenceCode(value) {
    if (typeof value !== 'string') return '?';
    const token = value.trim().toLowerCase();
    return ({
      s: 'S', red: 'S', sufficiency: 'S',
      n: 'N', blue: 'N', necessity: 'N',
      r: 'R', rescue: 'R',
      e: 'E', epistasis: 'E',
      i: 'I', directional_intervention: 'I',
      a: 'A', associational: 'A', association: 'A', correlation: 'A',
      o: 'O', localization: 'O', node_observation: 'O', descriptive: 'O',
      '0': '0', null_result: '0', no_change: '0',
      c: 'C', counterevidence: 'C', counterclaim: 'C', refutes: 'C',
      '?': '?', black: '?', intervention: '?', other: '?', inconclusive: '?', mixed: '?'
    })[token] || '?';
  }

  function safeGraphLabel(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    let text = value.normalize('NFKC')
      .replace(/<[\s\S]*?>/gu, ' ')
      .replace(/(?:javascript|vbscript|data)\s*:/giu, ' ')
      .replace(/%%/gu, ' ')
      .replace(/\b(?:click|classDef|linkStyle|subgraph|flowchart|graph)\b/giu, ' ')
      .replace(/\b(?:Figure|Fig\.?|Panel)\s*(?:S?\d+[A-Z]?|[A-Z]\d*)\b/giu, ' ')
      .replace(/[\u0000-\u001F\u007F]/gu, ' ')
      .replace(/["'`\[\]{}<>|;]/gu, ' ')
      .replace(/\s+/gu, ' ').trim();
    text = Array.from(text).slice(0, 120).join('').trim();
    return text || fallback;
  }

  function readAuditPresentation(value) {
    if (ownDataValue(value, 'version') !== 'mechanism-audit-view-v1' ||
        ownDataValue(value, 'status') !== 'complete') return null;
    const rawNodes = cappedDataArray(ownDataValue(value, 'nodes'), MAX_NODES);
    const nodes = [];
    const nodeIds = new Set();
    for (let index = 0; index < rawNodes.length; index += 1) {
      const raw = rawNodes[index];
      const id = boundedDisplayText(ownDataValue(raw, 'id'), 160);
      const label = boundedDisplayText(ownDataValue(raw, 'label'), 240);
      const nodeType = boundedDisplayText(ownDataValue(raw, 'nodeType'), 40);
      if (!id || !label || nodeIds.has(id)) return null;
      nodeIds.add(id);
      nodes.push({ id, label, nodeType });
    }
    if (!nodes.length) return null;
    const rawRelations = cappedDataArray(ownDataValue(value, 'relations'), MAX_EDGES);
    const relations = [];
    const relationIds = new Set();
    for (const raw of rawRelations) {
      const id = boundedDisplayText(ownDataValue(raw, 'id'), 160);
      const from = boundedDisplayText(ownDataValue(raw, 'from'), 160);
      const to = boundedDisplayText(ownDataValue(raw, 'to'), 160);
      const relationKind = ownDataValue(raw, 'relationKind') === 'correlative'
        ? 'correlative' : 'causal';
      const renderable = ownDataValue(raw, 'renderable') === true;
      const lineStyle = relationKind === 'correlative' ? 'dashed' : 'solid';
      const polarity = ['increases', 'decreases', 'no_change', 'mixed', 'unknown']
        .includes(ownDataValue(raw, 'polarity')) ? ownDataValue(raw, 'polarity') : 'unknown';
      if (!id || !from || !to || from === to || !nodeIds.has(from) ||
          !nodeIds.has(to) || relationIds.has(id)) return null;
      relationIds.add(id);
      const evidence = cappedDataArray(ownDataValue(raw, 'evidence'), 1024).map(item => ({
        claimId: boundedDisplayText(ownDataValue(item, 'claimId'), 160),
        panelKey: boundedDisplayText(ownDataValue(item, 'panelKey'), 100),
        code: normalizeMechanismEvidenceCode(ownDataValue(item, 'code')),
        role: ownDataValue(item, 'role') === 'counterclaim' ? 'counterclaim' : 'supporting'
      })).filter(item => item.claimId && item.panelKey);
      relations.push({
        id, from, to, relationKind, renderable, lineStyle,
        contested: ownDataValue(raw, 'contested') === true,
        polarity, evidence
      });
    }
    const rawPlacements = cappedDataArray(ownDataValue(value, 'placements'), 1024);
    const placements = [];
    const placedClaims = new Set();
    for (const raw of rawPlacements) {
      const claimId = boundedDisplayText(ownDataValue(raw, 'claimId'), 160);
      const panelKey = boundedDisplayText(ownDataValue(raw, 'panelKey'), 100);
      const from = boundedDisplayText(ownDataValue(raw, 'from'), 160);
      const to = boundedDisplayText(ownDataValue(raw, 'to'), 160);
      const code = normalizeMechanismEvidenceCode(ownDataValue(raw, 'code'));
      const roleValue = ownDataValue(raw, 'role');
      const role = roleValue === 'counterclaim' ? 'counterclaim'
        : roleValue === 'supporting' ? 'supporting' : 'audit';
      const placementRelationIds = cappedDataArray(
        ownDataValue(raw, 'relationIds'), MAX_EDGES
      ).map(id => boundedDisplayText(id, 160))
        .filter(id => relationIds.has(id));
      if (!claimId || !panelKey || !nodeIds.has(from) || !nodeIds.has(to) ||
          placedClaims.has(claimId) || !EVIDENCE_CODES.has(code)) return null;
      placedClaims.add(claimId);
      placements.push({
        claimId, panelKey, from, to, code, role,
        relationIds: [...new Set(placementRelationIds)]
      });
    }
    const disconnectedEvidence = cappedDataArray(
      ownDataValue(value, 'disconnectedEvidence'), MAX_NODES
    ).map(raw => {
      const nodeId = boundedDisplayText(ownDataValue(raw, 'nodeId'), 160);
      const label = boundedDisplayText(ownDataValue(raw, 'label'), 240);
      const codes = [...new Set(cappedDataArray(ownDataValue(raw, 'codes'), 10)
        .map(normalizeMechanismEvidenceCode))];
      const claimCount = ownDataValue(raw, 'claimCount');
      return nodeIds.has(nodeId) && label && Number.isSafeInteger(claimCount) && claimCount >= 0
        ? { nodeId, label, codes, claimCount } : null;
    }).filter(Boolean);
    const exclusions = cappedDataArray(ownDataValue(value, 'exclusions'), 512)
      .map(raw => ({
        panelKey: boundedDisplayText(ownDataValue(raw, 'panelKey'), 100),
        reason: ownDataValue(raw, 'reason') === 'source_backed_schematic'
          ? 'source_backed_schematic' : ''
      })).filter(item => item.panelKey && item.reason);
    return { nodes, relations, placements, disconnectedEvidence, exclusions };
  }

  function createMechanismAuditEvidenceMatrix(value) {
    const audit = readAuditPresentation(value);
    if (!audit) return { nodes: [], cells: [] };
    const nodes = audit.nodes.map(node => ({ id: node.id, label: node.label }));
    const relationsByPair = new Map();
    for (const relation of audit.relations) {
      const key = `${relation.from}\u0000${relation.to}`;
      if (!relationsByPair.has(key)) relationsByPair.set(key, []);
      relationsByPair.get(key).push(relation);
    }
    const evidenceByPair = new Map();
    for (const placement of audit.placements) {
      const key = `${placement.from}\u0000${placement.to}`;
      if (!evidenceByPair.has(key)) evidenceByPair.set(key, []);
      evidenceByPair.get(key).push({ ...placement });
    }
    const cells = [];
    nodes.forEach(row => nodes.forEach(column => {
      const key = `${row.id}\u0000${column.id}`;
      const relations = relationsByPair.get(key) || [];
      const positive = relations.filter(relation => relation.renderable);
      const causal = positive.some(relation => relation.relationKind === 'causal');
      const correlative = positive.some(relation => relation.relationKind === 'correlative');
      const cellEvidence = evidenceByPair.get(key) || [];
      const counterevidence = cellEvidence.some(item =>
        item.role === 'counterclaim' || item.code === 'C');
      cells.push({
        from: row.id,
        to: column.id,
        relationIds: relations.map(relation => relation.id),
        edgeIds: relations.map(relation => relation.id),
        relationDescriptors: relations.map((relation, index) => ({
          id: relation.id,
          ordinal: index + 1,
          polarity: relation.polarity,
          relationKind: relation.relationKind,
          contested: relation.contested,
          label: relationWording(relation),
          labelSource: 'generated'
        })),
        evidence: cellEvidence,
        lineStyle: causal ? 'solid' : correlative ? 'dashed' : 'none',
        contested: positive.length > 0 && (
          relations.some(relation => relation.contested) || counterevidence
        ),
        positiveEdge: positive.length > 0
      });
    }));
    return { nodes, cells };
  }

  function mechanismEvidenceClass(value, claimCode = '?') {
    if (value === 'sufficiency' || value === 'necessity' || value === 'other') {
      return value;
    }
    return claimCode === 'S' ? 'sufficiency'
      : claimCode === 'N' ? 'necessity' : 'other';
  }

  function splitAuditPanelKey(value) {
    const panelKey = boundedDisplayText(value, 260);
    const separator = panelKey.lastIndexOf(':');
    if (separator < 1 || separator === panelKey.length - 1) {
      return { panelKey, figureId: '', panelId: '' };
    }
    return {
      panelKey,
      figureId: boundedDisplayText(panelKey.slice(0, separator), 160),
      panelId: boundedDisplayText(panelKey.slice(separator + 1), 80)
    };
  }

  function auditedPanelCatalog(rawOptions) {
    const catalog = new Map();
    for (const raw of cappedDataArray(rawOptions, 512)) {
      const explicitKey = boundedDisplayText(ownDataValue(raw, 'panelKey'), 260);
      const figureId = boundedDisplayText(ownDataValue(raw, 'figureId'), 160);
      const panelId = boundedDisplayText(ownDataValue(raw, 'panelId'), 80);
      const panelKey = explicitKey || (figureId && panelId ? `${figureId}:${panelId}` : '');
      const originalDisplayId = boundedDisplayText(
        ownDataValue(raw, 'originalDisplayId') || ownDataValue(raw, 'displayId'), 80
      );
      if (!panelKey || !originalDisplayId || catalog.has(panelKey)) continue;
      catalog.set(panelKey, {
        originalDisplayId,
        evidenceClass: mechanismEvidenceClass(ownDataValue(raw, 'evidenceClass'))
      });
    }
    return catalog;
  }

  function auditedChainEvidenceRecords(chain, relevantRelationIds) {
    const graph = graphParts(chain);
    let locatorAuthority = graph.locatorAuthority;
    const edgeIdCounts = new Map();
    for (const edge of graph.edges) {
      edgeIdCounts.set(edge.id, (edgeIdCounts.get(edge.id) || 0) + 1);
    }
    const records = [];
    for (const edge of graph.edges) {
      const related = relevantRelationIds.has(edge.id);
      const evidenceRead = ownCappedDataArray(edge.source, 'panelEvidence', 64);
      if (related && !evidenceRead.complete) locatorAuthority = false;
      const evidence = evidenceRead.values;
      for (let evidenceIndex = 0; evidenceIndex < evidence.length; evidenceIndex += 1) {
        const item = evidence[evidenceIndex];
        const figureProperty = ownDataProperty(item, 'figureId');
        const panelProperty = ownDataProperty(item, 'panelId');
        const figureId = boundedDisplayText(
          figureProperty.readable && figureProperty.present ? figureProperty.value : undefined,
          160
        );
        const panelId = boundedDisplayText(
          panelProperty.readable && panelProperty.present ? panelProperty.value : undefined,
          80
        );
        if (!figureId || !panelId) {
          if (related) locatorAuthority = false;
          continue;
        }
        records.push({
          ownerEdgeId: edge.id,
          ownerEdgeIdUnique: edgeIdCounts.get(edge.id) === 1,
          from: edge.from,
          to: edge.to,
          evidenceIndex,
          panelKey: `${figureId}:${panelId}`,
          figureId,
          panelId,
          originalDisplayId: boundedDisplayText(ownDataValue(item, 'value'), 80),
          evidenceClass: mechanismEvidenceClass(ownDataValue(item, 'evidenceClass'))
        });
      }
    }
    return { records, locatorAuthority };
  }

  function auditedEvidenceLocatorBucket(index, edgeId, panelKey, from, to, create = false) {
    const parts = [edgeId, panelKey, from, to];
    let level = index;
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const finalPart = partIndex === parts.length - 1;
      let next = level.get(parts[partIndex]);
      if (!next && create) {
        next = finalPart ? [] : new Map();
        level.set(parts[partIndex], next);
      }
      if (!next) return null;
      if (finalPart) return next;
      level = next;
    }
    return null;
  }

  // Reconcile the immutable audit placement with the editable chain without
  // manufacturing ownership. Only an exact (relationIds, panelKey) singleton
  // receives an edit locator; node-only and ambiguous placements remain views.
  function createMechanismAuditEvidenceView(chain, value, panelOptions = []) {
    const audit = readAuditPresentation(value);
    const matrix = createMechanismAuditEvidenceMatrix(value);
    if (!audit) {
      return { version: 'mechanism-audit-evidence-view-v1', nodes: [], cells: [] };
    }
    const panelCatalog = auditedPanelCatalog(panelOptions);
    const relevantRelationIds = new Set();
    matrix.cells.forEach(cell => cell.evidence.forEach(placement => {
      placement.relationIds.forEach(relationId => relevantRelationIds.add(relationId));
    }));
    const evidenceRead = auditedChainEvidenceRecords(chain, relevantRelationIds);
    const records = evidenceRead.records;
    const recordsByPanel = new Map();
    const recordsByLocator = new Map();
    const recordOrder = new Map();
    records.forEach((record, index) => {
      recordOrder.set(record, index);
      if (!recordsByPanel.has(record.panelKey)) recordsByPanel.set(record.panelKey, []);
      recordsByPanel.get(record.panelKey).push(record);
      auditedEvidenceLocatorBucket(
        recordsByLocator,
        record.ownerEdgeId, record.panelKey, record.from, record.to,
        true
      ).push(record);
    });
    const cells = matrix.cells.map(cell => ({
      ...cell,
      evidence: cell.evidence.map(placement => {
        const panelIdentity = splitAuditPanelKey(placement.panelKey);
        const relationIds = new Set(placement.relationIds);
        const placementKind = relationIds.size === 0 && cell.from === cell.to
          ? 'node_only' : 'relation';
        const matches = [];
        if (placementKind !== 'node_only') {
          relationIds.forEach(relationId => {
            const candidates = auditedEvidenceLocatorBucket(
              recordsByLocator,
              relationId, panelIdentity.panelKey, cell.from, cell.to
            );
            if (candidates) matches.push(...candidates);
          });
          if (relationIds.size > 1 && matches.length > 1) {
            matches.sort((left, right) => recordOrder.get(left) - recordOrder.get(right));
          }
        }
        const catalogEntry = panelCatalog.get(panelIdentity.panelKey);
        const displayRecord = matches[0] || recordsByPanel.get(panelIdentity.panelKey)?.[0];
        const originalDisplayId = catalogEntry?.originalDisplayId ||
          displayRecord?.originalDisplayId || panelIdentity.panelKey;
        const candidateClasses = [...new Set(matches.map(item => item.evidenceClass))];
        const evidenceClass = mechanismEvidenceClass(
          matches.length === 1 ? matches[0].evidenceClass
            : candidateClasses.length === 1 ? candidateClasses[0]
              : catalogEntry?.evidenceClass,
          placement.code
        );
        const uniquelyMapped = evidenceRead.locatorAuthority && relationIds.size === 1 &&
          matches.length === 1 && matches[0].ownerEdgeIdUnique;
        const mappingStatus = placementKind === 'node_only' ? 'node_only'
          : uniquelyMapped ? 'unique'
            : matches.length > 0 ? 'ambiguous' : 'unmapped';
        return {
          ...placement,
          figureId: panelIdentity.figureId,
          panelId: panelIdentity.panelId,
          originalDisplayId,
          displayName: panelAliasValue(chain, panelIdentity.panelKey) || originalDisplayId,
          evidenceClass,
          claimCode: placement.code,
          placementKind,
          mappingStatus,
          ...(uniquelyMapped ? {
            ownerEdgeId: matches[0].ownerEdgeId,
            edgeId: matches[0].ownerEdgeId,
            evidenceIndex: matches[0].evidenceIndex
          } : {})
        };
      })
    }));
    return {
      version: 'mechanism-audit-evidence-view-v1',
      nodes: matrix.nodes,
      cells
    };
  }

  function graphComponents(nodes, edges) {
    const order = new Map(nodes.map((node, index) => [node.id, index]));
    const byNode = new Map(nodes.map(node => [node.id, []]));
    edges.forEach(edge => {
      byNode.get(edge.from)?.push(edge);
      byNode.get(edge.to)?.push(edge);
    });
    const visited = new Set();
    const components = [];
    for (const node of nodes) {
      if (visited.has(node.id) || !(byNode.get(node.id) || []).length) continue;
      const queue = [node.id];
      const nodeIds = [];
      const edgeIds = new Set();
      while (queue.length) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        nodeIds.push(id);
        for (const edge of byNode.get(id) || []) {
          edgeIds.add(edge.id);
          const next = edge.from === id ? edge.to : edge.from;
          if (!visited.has(next)) queue.push(next);
        }
      }
      nodeIds.sort((left, right) => order.get(left) - order.get(right));
      components.push({
        componentId: `component-${components.length + 1}`,
        nodeIds,
        edgeIds: [...edgeIds]
      });
    }
    return components;
  }

  function relationWording(relation) {
    if (relation.relationKind === 'correlative') return 'associated with';
    return relation.polarity === 'decreases' ? 'decreases' :
      relation.polarity === 'increases' ? 'increases' : 'affects';
  }

  function createMechanismGraphExportDto(value) {
    const audit = readAuditPresentation(value);
    if (audit) {
      const nodeOrder = new Map(audit.nodes.map((node, index) => [node.id, index]));
      const byPair = new Map();
      audit.relations.filter(relation => relation.renderable).forEach(relation => {
        const key = `${relation.from}\u0000${relation.to}`;
        if (!byPair.has(key)) byPair.set(key, []);
        byPair.get(key).push(relation);
      });
      const edges = [...byPair.values()].map((relations, index) => {
        const causal = relations.some(relation => relation.relationKind === 'causal');
        const basis = causal
          ? relations.find(relation => relation.relationKind === 'causal') : relations[0];
        const codes = [];
        relations.forEach(relation => relation.evidence.forEach(item => {
          if (!codes.includes(item.code)) codes.push(item.code);
        }));
        const pairCounterevidence = audit.placements.some(item =>
          item.from === basis.from && item.to === basis.to &&
          (item.role === 'counterclaim' || item.code === 'C'));
        if (pairCounterevidence && !codes.includes('C')) codes.push('C');
        codes.sort((left, right) =>
          EVIDENCE_CODE_ORDER.indexOf(left) - EVIDENCE_CODE_ORDER.indexOf(right));
        return {
          id: `graph-edge-${index + 1}`,
          from: basis.from,
          to: basis.to,
          label: relationWording(basis),
          lineStyle: causal ? 'solid' : 'dashed',
          contested: relations.some(relation => relation.contested) || pairCounterevidence,
          codes,
          polarity: basis.polarity === 'decreases' ? 'negative'
            : basis.polarity === 'increases' ? 'positive' : 'neutral'
        };
      });
      const connected = new Set(edges.flatMap(edge => [edge.from, edge.to]));
      const nodes = audit.nodes.filter(node => connected.has(node.id)).map((node, index) => ({
        id: node.id,
        label: safeGraphLabel(node.label, `Mechanism node ${index + 1}`)
      }));
      edges.sort((left, right) => {
        const byFrom = nodeOrder.get(left.from) - nodeOrder.get(right.from);
        return byFrom || nodeOrder.get(left.to) - nodeOrder.get(right.to);
      });
      const components = graphComponents(nodes, edges);
      return {
        schema: 'brevess.mechanism-graph', schemaVersion: 1,
        nodes, edges, components,
        disconnectedEvidence: audit.disconnectedEvidence.map((item, index) => ({
          nodeId: item.nodeId,
          label: safeGraphLabel(item.label, `Evidence-only node ${index + 1}`),
          codes: item.codes.filter(code => EVIDENCE_CODES.has(code)),
          claimCount: item.claimCount
        })),
        exclusions: audit.exclusions.length
          ? [{ reason: 'source_backed_schematic', count: audit.exclusions.length }] : []
      };
    }
    const graph = graphParts(value);
    const nodes = graph.nodes.map((node, index) => ({
      id: node.id,
      label: safeGraphLabel(mechanismNodeLabel(
        node.source, `Mechanism node ${index + 1}`
      ), `Mechanism node ${index + 1}`)
    }));
    const edges = graph.edges.filter(edge => edge.from !== edge.to).map((edge, index) => ({
      id: `graph-edge-${index + 1}`,
      from: edge.from,
      to: edge.to,
      label: edge.polarity === 'negative' ? 'decreases'
        : edge.polarity === 'positive' ? 'increases' : 'affects',
      lineStyle: ownDataValue(edge.source, 'relationKind') === 'correlative'
        ? 'dashed' : 'solid',
      contested: ownDataValue(edge.source, 'contested') === true,
      codes: [],
      polarity: edge.polarity
    }));
    return {
      schema: 'brevess.mechanism-graph', schemaVersion: 1,
      nodes, edges, components: graphComponents(nodes, edges),
      disconnectedEvidence: [], exclusions: []
    };
  }

  function readGraphExportDto(value) {
    if (ownDataValue(value, 'schema') !== 'brevess.mechanism-graph' ||
        ownDataValue(value, 'schemaVersion') !== 1) return null;
    const nodes = cappedDataArray(ownDataValue(value, 'nodes'), MAX_NODES).map((raw, index) => ({
      id: boundedDisplayText(ownDataValue(raw, 'id'), 160),
      label: safeGraphLabel(ownDataValue(raw, 'label'), `Mechanism node ${index + 1}`)
    }));
    const ids = new Set(nodes.map(node => node.id));
    if (!nodes.length || ids.size !== nodes.length || nodes.some(node => !node.id)) return null;
    const edges = cappedDataArray(ownDataValue(value, 'edges'), MAX_EDGES).map(raw => ({
      id: boundedDisplayText(ownDataValue(raw, 'id'), 160),
      from: boundedDisplayText(ownDataValue(raw, 'from'), 160),
      to: boundedDisplayText(ownDataValue(raw, 'to'), 160),
      label: safeGraphLabel(ownDataValue(raw, 'label'), 'affects'),
      lineStyle: ownDataValue(raw, 'lineStyle') === 'dashed' ? 'dashed' : 'solid',
      contested: ownDataValue(raw, 'contested') === true,
      codes: [...new Set(cappedDataArray(ownDataValue(raw, 'codes'), 10)
        .map(normalizeMechanismEvidenceCode))],
      polarity: ['positive', 'negative'].includes(ownDataValue(raw, 'polarity'))
        ? ownDataValue(raw, 'polarity') : 'neutral'
    }));
    if (edges.some(edge => !edge.id || !ids.has(edge.from) || !ids.has(edge.to) ||
        edge.from === edge.to)) return null;
    return { nodes, edges };
  }

  function mechanismAuditRelationDisplayLabel(edge, language, generatedRelationLabels = false) {
    const english = String(language || '').toLowerCase().startsWith('en');
    const raw = boundedDisplayText(ownDataValue(edge, 'label'), 120);
    const generated = new Set(['associated with', 'decreases', 'increases', 'affects']);
    if (raw && (!generatedRelationLabels || !generated.has(raw.toLowerCase()))) return raw;
    if (ownDataValue(edge, 'lineStyle') === 'dashed' || raw.toLowerCase() === 'associated with') {
      return english ? 'associated with' : '相关';
    }
    const polarity = ownDataValue(edge, 'polarity');
    if (polarity === 'negative' || raw.toLowerCase() === 'decreases') {
      return english ? 'decreases' : '抑制';
    }
    if (polarity === 'positive' || raw.toLowerCase() === 'increases') {
      return english ? 'increases' : '促进';
    }
    return english ? 'affects' : '影响';
  }

  function createMechanismAuditMermaidDefinition(value, options = {}) {
    const graph = readGraphExportDto(value);
    if (!graph) return '';
    const direction = String(options.direction || '').toUpperCase() === 'TD' ? 'TD' : 'LR';
    const language = String(options.language || '').toLowerCase().startsWith('zh')
      ? 'zh-CN' : 'en';
    const generatedRelationLabels = options.generatedRelationLabels === true;
    const aliases = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
    const lines = [`flowchart ${direction}`];
    graph.nodes.forEach(node => {
      lines.push(`  ${aliases.get(node.id)}["${node.label.replace(/&/gu, '&amp;')}"]`);
    });
    graph.edges.forEach((edge, index) => {
      const relationLabel = mechanismAuditRelationDisplayLabel(
        edge, language, generatedRelationLabels
      );
      const label = edge.contested
        ? (language === 'en' ? `contested: ${relationLabel}` : `有争议：${relationLabel}`)
        : relationLabel;
      lines.push(edge.lineStyle === 'dashed'
        ? `  ${aliases.get(edge.from)} -. ${label} .-> ${aliases.get(edge.to)}`
        : `  ${aliases.get(edge.from)} -->|${label}| ${aliases.get(edge.to)}`);
      const styles = edge.lineStyle === 'dashed'
        ? ['stroke:#111', 'stroke-dasharray:7 5'] : ['stroke:#354f5e'];
      if (edge.contested) styles.push('stroke:#8b5c20', 'stroke-width:3px');
      lines.push(`  linkStyle ${index} ${styles.join(',')}`);
    });
    return lines.join('\n');
  }

  function findMechanismStrongComponents(chain) {
    const { nodeIds, edges } = graphParts(chain);
    const order = new Map(nodeIds.map((id, index) => [id, index]));
    const outgoing = new Map(nodeIds.map(id => [id, []]));
    edges.forEach(edge => outgoing.get(edge.from).push(edge.to));
    outgoing.forEach(values => values.sort((left, right) =>
      order.get(left) - order.get(right)));

    let nextIndex = 0;
    const indexById = new Map();
    const lowById = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];

    function visit(id) {
      indexById.set(id, nextIndex);
      lowById.set(id, nextIndex);
      nextIndex += 1;
      stack.push(id);
      onStack.add(id);
      outgoing.get(id).forEach(target => {
        if (!indexById.has(target)) {
          visit(target);
          lowById.set(id, Math.min(lowById.get(id), lowById.get(target)));
        } else if (onStack.has(target)) {
          lowById.set(id, Math.min(lowById.get(id), indexById.get(target)));
        }
      });
      if (lowById.get(id) !== indexById.get(id)) return;
      const component = [];
      while (stack.length) {
        const member = stack.pop();
        onStack.delete(member);
        component.push(member);
        if (member === id) break;
      }
      component.sort((left, right) => order.get(left) - order.get(right));
      components.push(component);
    }

    nodeIds.forEach(id => {
      if (!indexById.has(id)) visit(id);
    });
    return components.sort((left, right) =>
      order.get(left[0]) - order.get(right[0]));
  }

  function mechanismNetworkFocusSet(chain, selection = {}) {
    const { nodeIds, edges } = graphParts(chain);
    const selectedEdge = edges.find(edge => edge.id === selection?.edgeId);
    const seeds = selectedEdge
      ? [selectedEdge.from, selectedEdge.to]
      : nodeIds.includes(selection?.nodeId) ? [selection.nodeId] : nodeIds;
    const forward = new Map(nodeIds.map(id => [id, []]));
    const reverse = new Map(nodeIds.map(id => [id, []]));
    edges.forEach(edge => {
      forward.get(edge.from).push(edge.to);
      reverse.get(edge.to).push(edge.from);
    });

    function traverse(table) {
      const visited = new Set(seeds);
      const queue = seeds.slice();
      while (queue.length) {
        const id = queue.shift();
        table.get(id).forEach(next => {
          if (visited.has(next)) return;
          visited.add(next);
          queue.push(next);
        });
      }
      return visited;
    }

    const nodeIdsInFocus = new Set([...traverse(forward), ...traverse(reverse)]);
    const edgeIdsInFocus = new Set(edges.filter(edge =>
      nodeIdsInFocus.has(edge.from) && nodeIdsInFocus.has(edge.to)
    ).map(edge => edge.id));
    return { nodeIds: nodeIdsInFocus, edgeIds: edgeIdsInFocus };
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function componentGraph(chain) {
    const graph = graphParts(chain);
    const components = findMechanismStrongComponents(chain);
    const componentByNode = new Map();
    components.forEach((nodeIds, index) => nodeIds.forEach(id => {
      componentByNode.set(id, index);
    }));
    const outgoing = new Map(components.map((_, index) => [index, new Set()]));
    const incoming = new Map(components.map((_, index) => [index, new Set()]));
    graph.edges.forEach(edge => {
      const from = componentByNode.get(edge.from);
      const to = componentByNode.get(edge.to);
      if (from === to || outgoing.get(from).has(to)) return;
      outgoing.get(from).add(to);
      incoming.get(to).add(from);
    });
    return { ...graph, components, componentByNode, outgoing, incoming };
  }

  function acyclicNodeRanks(graph, pinnedRanks) {
    const outgoing = new Map(graph.nodeIds.map(id => [id, new Set()]));
    const incoming = new Map(graph.nodeIds.map(id => [id, new Set()]));
    const backboneEdgeIds = new Set();

    function hasPath(from, target) {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        const id = queue.shift();
        if (id === target) return true;
        outgoing.get(id).forEach(next => {
          if (!seen.has(next)) { seen.add(next); queue.push(next); }
        });
      }
      return false;
    }

    graph.edges.forEach(edge => {
      if (edge.from === edge.to || hasPath(edge.to, edge.from)) return;
      outgoing.get(edge.from).add(edge.to);
      incoming.get(edge.to).add(edge.from);
      backboneEdgeIds.add(edge.id);
    });
    const indegree = new Map([...incoming.entries()].map(([id, values]) =>
      [id, values.size]));
    const rankByNode = new Map(graph.nodeIds.map(id => [id, 0]));
    const sourceOrder = new Map(graph.nodeIds.map((id, index) => [id, index]));
    const queue = graph.nodeIds.filter(id => indegree.get(id) === 0);
    while (queue.length) {
      const current = queue.shift();
      [...outgoing.get(current)].sort((left, right) =>
        sourceOrder.get(left) - sourceOrder.get(right)).forEach(next => {
        rankByNode.set(next, Math.max(rankByNode.get(next), rankByNode.get(current) + 1));
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) queue.push(next);
      });
    }
    pinnedRanks.forEach((rank, id) => rankByNode.set(id, rank));
    return { rankByNode, backboneEdgeIds };
  }

  function layoutPreferenceMaps(options, allowed) {
    const source = options?.layoutPreferences;
    const pinnedRanks = new Map();
    const siblingOrder = new Map();
    for (const [key, target] of [
      ['pinnedRanks', pinnedRanks], ['siblingOrder', siblingOrder]
    ]) {
      const raw = ownDataValue(source, key);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      let descriptors;
      try { descriptors = Object.getOwnPropertyDescriptors(raw); }
      catch (_) { continue; }
      Object.keys(descriptors).sort().slice(0, MAX_NODES).forEach(id => {
        const descriptor = descriptors[id];
        const value = descriptor && Object.hasOwn(descriptor, 'value')
          ? descriptor.value : NaN;
        if (allowed.has(id) && Number.isSafeInteger(value) && value >= 0 && value < 64) {
          target.set(id, value);
        }
      });
    }
    return { pinnedRanks, siblingOrder };
  }

  function orderedRankRows(graph, rankByNode, siblingOrder) {
    const sourceOrder = new Map(graph.nodeIds.map((id, index) => [id, index]));
    const rows = new Map();
    graph.nodeIds.forEach(id => {
      const rank = rankByNode.get(id);
      if (!rows.has(rank)) rows.set(rank, []);
      rows.get(rank).push(id);
    });
    rows.forEach(ids => ids.sort((left, right) => {
      const leftOrder = siblingOrder.has(left) ? siblingOrder.get(left) : sourceOrder.get(left);
      const rightOrder = siblingOrder.has(right) ? siblingOrder.get(right) : sourceOrder.get(right);
      return leftOrder - rightOrder || sourceOrder.get(left) - sourceOrder.get(right);
    }));
    const incoming = new Map(graph.nodeIds.map(id => [id, []]));
    const outgoing = new Map(graph.nodeIds.map(id => [id, []]));
    graph.edges.forEach(edge => {
      outgoing.get(edge.from).push(edge.to);
      incoming.get(edge.to).push(edge.from);
    });
    const ranks = [...rows.keys()].sort((left, right) => left - right);
    for (let sweep = 0; sweep < 4; sweep += 1) {
      const forward = sweep % 2 === 0;
      const visitRanks = forward ? ranks : ranks.slice().reverse();
      const neighborTable = forward ? incoming : outgoing;
      const position = new Map();
      rows.forEach(ids => ids.forEach((id, index) => position.set(id, index)));
      visitRanks.forEach(row => {
        rows.get(row).sort((left, right) => {
          function barycenter(id) {
            const values = neighborTable.get(id).map(neighbor => position.get(neighbor))
              .filter(Number.isFinite);
            return values.length
              ? values.reduce((sum, value) => sum + value, 0) / values.length
              : position.get(id);
          }
          return barycenter(left) - barycenter(right) ||
            (siblingOrder.get(left) ?? sourceOrder.get(left)) -
              (siblingOrder.get(right) ?? sourceOrder.get(right)) ||
            sourceOrder.get(left) - sourceOrder.get(right);
        });
        rows.get(row).forEach((id, index) => position.set(id, index));
      });
    }
    return rows;
  }

  function positionMechanismNodes(graph, rows, rankByNode, options) {
    const nodeSizes = options?.nodeSizes instanceof Map ? options.nodeSizes : new Map();
    const defaultWidth = Math.max(148, Math.min(220,
      finiteNumber(options?.nodeWidth, 184)));
    const gapX = 24;
    const gapY = 82;
    const margin = 24;
    const rowData = [];
    let y = 32;
    [...rows.entries()].sort((left, right) => left[0] - right[0])
      .forEach(([rank, ids]) => {
        const sizes = ids.map(id => ({
          id,
          width: Math.max(120, Math.min(260,
            finiteNumber(nodeSizes.get(id)?.width, defaultWidth))),
          height: Math.max(52, Math.min(180,
            finiteNumber(nodeSizes.get(id)?.height, 68)))
        }));
        const totalWidth = sizes.reduce((sum, item) => sum + item.width, 0) +
          gapX * Math.max(0, sizes.length - 1);
        const rowHeight = Math.max(52, ...sizes.map(item => item.height));
        rowData.push({ rank, sizes, totalWidth, rowHeight, y });
        y += rowHeight + gapY;
      });
    const naturalWidth = Math.max(0, ...rowData.map(row => row.totalWidth)) + margin * 2;
    const baseWidth = Math.max(320, finiteNumber(options?.viewportWidth, 680), naturalWidth);
    const nodes = [];
    rowData.forEach(row => {
      let x = Math.max(margin, (baseWidth - row.totalWidth) / 2);
      row.sizes.forEach(size => {
        const componentIndex = graph.componentByNode.get(size.id);
        nodes.push({
          id: size.id,
          x,
          y: row.y + (row.rowHeight - size.height) / 2,
          width: size.width,
          height: size.height,
          rank: rankByNode.get(size.id),
          componentId: `scc-${componentIndex}`
        });
        x += size.width + gapX;
      });
    });
    return {
      nodes,
      baseWidth,
      baseHeight: Math.max(160, y - gapY + 32)
    };
  }

  function normalEdgePath(from, to, lane, polarity) {
    const startX = from.x + from.width / 2 + lane * 5;
    const startY = from.y + from.height;
    const endX = to.x + to.width / 2 + lane * 5;
    const endY = to.y;
    const middleY = startY + (endY - startY) / 2;
    return {
      path: `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`,
      hitPath: '',
      labelX: (startX + endX) / 2,
      labelY: middleY,
      endX,
      endY,
      feedback: false,
      selfLoop: false,
      polarity
    };
  }

  function feedbackEdgePath(from, to, trackX, polarity) {
    const startX = from.x + from.width;
    const startY = from.y + from.height / 2;
    const endX = to.x + to.width;
    const endY = to.y + to.height / 2;
    return {
      path: `M ${startX} ${startY} C ${trackX} ${startY}, ${trackX} ${endY}, ${endX} ${endY}`,
      hitPath: '',
      labelX: trackX - 6,
      labelY: Math.max(16, (startY + endY) / 2),
      endX,
      endY,
      feedback: true,
      selfLoop: false,
      polarity
    };
  }

  function selfLoopEdgePath(node, trackX, polarity) {
    const startX = node.x + node.width;
    const startY = node.y + node.height * 0.32;
    const endX = node.x + node.width;
    const endY = node.y + node.height * 0.68;
    const bendX = Math.max(trackX, startX + 34);
    return {
      path: `M ${startX} ${startY} C ${bendX} ${startY - 24}, ${bendX} ${endY + 24}, ${endX} ${endY}`,
      hitPath: '',
      labelX: bendX - 4,
      labelY: node.y + node.height / 2,
      endX,
      endY,
      feedback: true,
      selfLoop: true,
      polarity
    };
  }

  function routeMechanismEdges(graph, positioned, backboneEdgeIds) {
    const nodeById = new Map(positioned.nodes.map(node => [node.id, node]));
    const right = Math.max(positioned.baseWidth,
      ...positioned.nodes.map(node => node.x + node.width));
    let feedbackLane = 0;
    const parallelCount = new Map();
    const edges = graph.edges.map(edge => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      const key = `${edge.from}\u0000${edge.to}`;
      const lane = parallelCount.get(key) || 0;
      parallelCount.set(key, lane + 1);
      const selfLoop = from.id === to.id;
      const isFeedback = selfLoop || !backboneEdgeIds.has(edge.id) ||
        to.rank <= from.rank;
      let routed;
      if (selfLoop) {
        routed = selfLoopEdgePath(from, right + 42 + feedbackLane * 22, edge.polarity);
        feedbackLane += 1;
      } else if (isFeedback) {
        routed = feedbackEdgePath(from, to, right + 42 + feedbackLane * 22,
          edge.polarity);
        feedbackLane += 1;
      } else {
        routed = normalEdgePath(from, to, lane, edge.polarity);
      }
      routed.hitPath = routed.path;
      return { id: edge.id, from: edge.from, to: edge.to, ...routed };
    });
    const width = Math.max(positioned.baseWidth,
      right + (feedbackLane ? 70 + (feedbackLane - 1) * 22 : 24));
    return { edges, width, height: positioned.baseHeight };
  }

  function createMechanismNetworkLayout(chain, options = {}) {
    const graph = componentGraph(chain);
    const preferences = layoutPreferenceMaps(options, new Set(graph.nodeIds));
    const { rankByNode, backboneEdgeIds } = acyclicNodeRanks(
      graph, preferences.pinnedRanks
    );
    const rows = orderedRankRows(graph, rankByNode, preferences.siblingOrder);
    const positioned = positionMechanismNodes(graph, rows, rankByNode, options);
    const routed = routeMechanismEdges(graph, positioned, backboneEdgeIds);
    return {
      width: routed.width,
      height: routed.height,
      nodes: positioned.nodes,
      edges: routed.edges,
      components: graph.components.map((nodeIds, index) => ({
        id: `scc-${index}`,
        nodeIds: nodeIds.slice(),
        rank: Math.min(...nodeIds.map(id => rankByNode.get(id)))
      }))
    };
  }

  function mechanismLayoutFingerprint(input = {}) {
    const chain = ownDataValue(input, 'chain');
    const graph = graphParts(chain);
    const options = ownDataValue(input, 'options');
    const revision = ownDataValue(input, 'revision');
    const viewportWidth = ownDataValue(options, 'viewportWidth') ??
      ownDataValue(input, 'width');
    const nodeSizes = ownDataValue(options, 'nodeSizes');
    const sizeValues = graph.nodeIds.map(id => {
      let value;
      try { value = nodeSizes instanceof Map ? nodeSizes.get(id) : undefined; }
      catch (_) { value = undefined; }
      return [
        id,
        Math.round(finiteNumber(ownDataValue(value, 'width'), 0)),
        Math.round(finiteNumber(ownDataValue(value, 'height'), 0))
      ];
    });
    const preferences = ownDataValue(options, 'layoutPreferences');
    const preferenceValues = ['pinnedRanks', 'siblingOrder'].map(key => {
      const value = ownDataValue(preferences, key);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [key, []];
      let descriptors;
      try { descriptors = Object.getOwnPropertyDescriptors(value); }
      catch (_) { return [key, []]; }
      return [key, Object.keys(descriptors).sort().slice(0, MAX_NODES).map(id => {
        const descriptor = descriptors[id];
        return [id, descriptor && Object.hasOwn(descriptor, 'value') &&
          Number.isSafeInteger(descriptor.value) ? descriptor.value : null];
      })];
    });
    return JSON.stringify({
      revision: Number.isSafeInteger(revision) ? revision : 0,
      viewportWidth: Math.round(finiteNumber(viewportWidth, 680)),
      nodes: graph.nodeIds,
      edges: graph.edges.map(edge => [
        edge.id, edge.from, edge.to, edge.polarity
      ]),
      sizeValues,
      preferenceValues
    });
  }

  function createMechanismLayoutCache(build, maximum = 12) {
    if (typeof build !== 'function') {
      throw new TypeError('MECHANISM_NETWORK_LAYOUT_BUILD_REQUIRED');
    }
    const limit = Number.isSafeInteger(maximum)
      ? Math.max(1, Math.min(32, maximum)) : 12;
    const entries = new Map();
    return Object.freeze({
      get(input) {
        const key = mechanismLayoutFingerprint(input);
        if (entries.has(key)) {
          const cached = entries.get(key);
          entries.delete(key);
          entries.set(key, cached);
          return cached;
        }
        const value = build(input);
        entries.set(key, value);
        while (entries.size > limit) entries.delete(entries.keys().next().value);
        return value;
      },
      clear() { entries.clear(); },
      size() { return entries.size; }
    });
  }

  function mechanismEdgeAccessibleName(value = {}, options = {}) {
    const bounded = input => typeof input === 'string'
      ? Array.from(input.normalize('NFKC').replace(/\s+/gu, ' ').trim())
          .slice(0, 120).join('')
      : '';
    const fromLabel = bounded(ownDataValue(value, 'fromLabel')) || '未命名节点';
    const toLabel = bounded(ownDataValue(value, 'toLabel')) || '未命名节点';
    const polarity = ownDataValue(value, 'polarity');
    const kind = polarity === 'negative' ? '负反馈'
      : polarity === 'positive' ? '正反馈' : '联系';
    const rawCount = ownDataValue(value, 'evidenceCount');
    const evidenceCount = Number.isSafeInteger(rawCount)
      ? Math.max(0, Math.min(32, rawCount)) : 0;
    const english = String(ownDataValue(options, 'language') || '')
      .toLowerCase().startsWith('en');
    if (english) {
      const relation = polarity === 'negative' ? 'negative relation'
        : polarity === 'positive' ? 'positive relation' : 'neutral relation';
      const contested = ownDataValue(value, 'contested') === true ? 'Contested ' : '';
      return `${contested}${relation} from “${fromLabel}” to “${toLabel}”, ` +
        `${evidenceCount} Panel evidence item${evidenceCount === 1 ? '' : 's'}`;
    }
    const contested = ownDataValue(value, 'contested') === true ? '有争议：' : '';
    return `${contested}从“${fromLabel}”到“${toLabel}”的${kind}，${evidenceCount} 项 Panel 证据`;
  }

  function createMechanismFrameScheduler(schedule) {
    if (typeof schedule !== 'function') {
      throw new TypeError('MECHANISM_NETWORK_FRAME_SCHEDULER_REQUIRED');
    }
    let pending = false;
    let latest = null;
    return Object.freeze({
      request(callback) {
        if (typeof callback !== 'function') return false;
        latest = callback;
        if (pending) return false;
        pending = true;
        schedule(() => {
          pending = false;
          const work = latest;
          latest = null;
          if (work) work();
        });
        return true;
      },
      clear() { latest = null; },
      pending() { return pending; }
    });
  }

  function mechanismNetworkError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function invalidImport() {
    throw mechanismNetworkError('MECHANISM_NETWORK_IMPORT_INVALID');
  }

  function descriptorRecord(value, allowedKeys, requiredKeys = []) {
    if (!value || typeof value !== 'object') invalidImport();
    let isArray;
    let prototype;
    let names;
    let symbols;
    try {
      isArray = Array.isArray(value);
      prototype = Object.getPrototypeOf(value);
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_) {
      invalidImport();
    }
    if (isArray || (prototype !== Object.prototype && prototype !== null) || symbols.length) {
      invalidImport();
    }
    const allowed = new Set(allowedKeys);
    if (names.some(key => BLOCKED_KEYS.has(key) || !allowed.has(key)) ||
        requiredKeys.some(key => !names.includes(key))) invalidImport();
    const result = {};
    for (const key of names) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { invalidImport(); }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalidImport();
      result[key] = descriptor.value;
    }
    return result;
  }

  function descriptorArray(value, maximum) {
    let isArray;
    let lengthDescriptor;
    let names;
    let symbols;
    try {
      isArray = Array.isArray(value);
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_) {
      invalidImport();
    }
    if (!isArray) invalidImport();
    const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
      ? lengthDescriptor.value : -1;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum || symbols.length ||
        names.some(name => name !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(name))) {
      invalidImport();
    }
    const result = [];
    for (let index = 0; index < length; index += 1) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); }
      catch (_) { invalidImport(); }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalidImport();
      result.push(descriptor.value);
    }
    return result;
  }

  function safeExportText(value, maximum, strictCanonical = false) {
    if (typeof value !== 'string' || value.length > maximum * 2) invalidImport();
    const normalized = value.normalize('NFKC')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
      .replace(/\s+/gu, ' ').trim();
    if ((strictCanonical && normalized !== value) ||
        Array.from(normalized).length > maximum ||
        (!strictCanonical && (
          /(?:https?|file|data|blob|javascript):|(?:^|\s)\/\//iu.test(normalized) ||
          /(?:authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|password)\b/iu.test(normalized)
        ))) {
      invalidImport();
    }
    return normalized;
  }

  function figureWorkspaceContractMethod(name) {
    let api;
    try { api = host && host.SciLLM; } catch (_) { api = null; }
    if (typeof api?.[name] === 'function') return api[name];
    if (typeof require === 'function') {
      try { api = require('./figure-workspace.js'); } catch (_) { api = null; }
    }
    if (typeof api?.[name] !== 'function') invalidImport();
    return api[name];
  }

  function safeMechanismText(value, maximum, strictCanonical = false) {
    const text = safeExportText(value, maximum, strictCanonical);
    if (strictCanonical) {
      let accepted = false;
      try {
        accepted = figureWorkspaceContractMethod(
          'isCanonicalMechanismWorkspaceText'
        )(text, maximum) === true;
      } catch (_) {}
      if (!accepted) invalidImport();
    }
    return text;
  }

  function safeExportId(value, maximum = 200, strictCanonical = false) {
    const id = safeExportText(value, maximum, strictCanonical);
    if (!id || BLOCKED_KEYS.has(id.toLowerCase()) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) invalidImport();
    return id;
  }

  function safeMechanismId(value, maximum, strictCanonical = false) {
    const id = safeExportId(value, maximum, strictCanonical);
    if (strictCanonical) safeMechanismText(id, maximum, true);
    return id;
  }

  function safeEditable(value, maximum, strictCanonical = false) {
    if (strictCanonical && typeof value === 'string') invalidImport();
    const source = typeof value === 'string'
      ? { value } : descriptorRecord(value, ['value', 'humanReviewed', 'editedAt'],
        strictCanonical ? ['value', 'humanReviewed', 'editedAt'] : ['value']);
    const humanReviewed = Object.hasOwn(source, 'humanReviewed')
      ? source.humanReviewed : false;
    const editedAt = Object.hasOwn(source, 'editedAt') ? source.editedAt : 0;
    if (typeof humanReviewed !== 'boolean' || !Number.isSafeInteger(editedAt) || editedAt < 0) {
      invalidImport();
    }
    safeReviewTimestamp(editedAt);
    return {
      value: safeMechanismText(source.value, maximum, strictCanonical),
      humanReviewed,
      editedAt
    };
  }

  function safePanelEvidence(value, strictCanonical = false) {
    const source = descriptorRecord(value, [
      'figureId', 'panelId', 'value', 'unresolved', 'evidenceClass',
      'evidenceClassSource', 'humanReviewed', 'editedAt'
    ], strictCanonical
      ? ['figureId', 'panelId', 'value', 'unresolved', 'humanReviewed', 'editedAt']
      : ['figureId', 'panelId', 'value']);
    const unresolved = source.unresolved === true;
    const figureId = unresolved && source.figureId === ''
      ? '' : safeMechanismId(source.figureId, 160, strictCanonical);
    const panelId = unresolved && source.panelId === ''
      ? '' : safeMechanismId(source.panelId, 32, strictCanonical);
    if (unresolved !== (figureId === '' && panelId === '') ||
        (figureId === '') !== (panelId === '') ||
        (panelId && !/^[A-Z][A-Z0-9_-]*$/u.test(panelId))) invalidImport();
    const result = {
      figureId,
      panelId,
      value: safeMechanismText(source.value, 4000, strictCanonical),
      unresolved,
      humanReviewed: source.humanReviewed === true,
      editedAt: Number.isSafeInteger(source.editedAt) && source.editedAt >= 0
        ? source.editedAt : 0
    };
    if (Object.hasOwn(source, 'unresolved') && typeof source.unresolved !== 'boolean') {
      invalidImport();
    }
    if (Object.hasOwn(source, 'humanReviewed') &&
        typeof source.humanReviewed !== 'boolean') invalidImport();
    if (Object.hasOwn(source, 'editedAt') &&
        (!Number.isSafeInteger(source.editedAt) || source.editedAt < 0)) invalidImport();
    safeReviewTimestamp(result.editedAt);
    if (Object.hasOwn(source, 'evidenceClass')) {
      if (!['sufficiency', 'necessity', 'other'].includes(source.evidenceClass)) {
        invalidImport();
      }
      result.evidenceClass = source.evidenceClass;
    }
    if (Object.hasOwn(source, 'evidenceClassSource')) {
      if (!['inferred', 'manual'].includes(source.evidenceClassSource)) invalidImport();
      if (!Object.hasOwn(result, 'evidenceClass')) invalidImport();
      result.evidenceClassSource = source.evidenceClassSource;
    }
    return result;
  }

  function safeLayoutPreferences(value, nodeIds, strictCanonical = false) {
    if (typeof value === 'undefined') return undefined;
    const source = descriptorRecord(value, [
      'pinnedRanks', 'siblingOrder', 'collapsedGroups'
    ], strictCanonical ? ['pinnedRanks', 'siblingOrder', 'collapsedGroups'] : []);
    const result = {};
    for (const key of ['pinnedRanks', 'siblingOrder']) {
      if (!Object.hasOwn(source, key)) continue;
      const values = descriptorRecord(source[key], [...nodeIds]);
      const normalized = {};
      Object.entries(values).forEach(([id, position]) => {
        if (!nodeIds.has(id) || !Number.isSafeInteger(position) ||
            position < 0 || position > 63) invalidImport();
        normalized[id] = position;
      });
      if (Object.keys(normalized).length || strictCanonical) result[key] = normalized;
    }
    if (Object.hasOwn(source, 'collapsedGroups')) {
      const seen = new Set();
      const collapsedGroups = descriptorArray(source.collapsedGroups, 16)
        .map(id => safeMechanismId(id, 80, strictCanonical));
      if (collapsedGroups.some(id => seen.has(id) || !seen.add(id))) invalidImport();
      if (collapsedGroups.length || strictCanonical) result.collapsedGroups = collapsedGroups;
    }
    if (strictCanonical &&
        !Object.keys(result.pinnedRanks || {}).length &&
        !Object.keys(result.siblingOrder || {}).length &&
        !(result.collapsedGroups || []).length) invalidImport();
    return Object.keys(result).length ? result : undefined;
  }

  function safeReviewTimestamp(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 4102444800000) {
      invalidImport();
    }
    return value;
  }

  function safeMechanismReviewTombstones(value, strictCanonical = false) {
    const source = descriptorRecord(value, ['nodes', 'edges', 'evidence'],
      strictCanonical ? ['nodes', 'edges', 'evidence'] : []);
    const unique = (items, keyOf) => {
      const seen = new Set();
      items.forEach(item => {
        const key = keyOf(item);
        if (seen.has(key)) invalidImport();
        seen.add(key);
      });
      return items;
    };
    const nodes = unique(descriptorArray(source.nodes, 64).map(raw => {
      const item = descriptorRecord(raw, ['id', 'editedAt'], ['id', 'editedAt']);
      return {
        id: safeMechanismId(item.id, 80, strictCanonical),
        editedAt: safeReviewTimestamp(item.editedAt)
      };
    }), item => item.id);
    const edges = unique(descriptorArray(source.edges, 64).map(raw => {
      const item = descriptorRecord(raw, ['id', 'from', 'to', 'editedAt'], [
        'id', 'from', 'to', 'editedAt'
      ]);
      return {
        id: safeMechanismId(item.id, 80, strictCanonical),
        from: safeMechanismId(item.from, 80, strictCanonical),
        to: safeMechanismId(item.to, 80, strictCanonical),
        editedAt: safeReviewTimestamp(item.editedAt)
      };
    }), item => `${item.id}\u0000${item.from}\u0000${item.to}`);
    const evidence = unique(descriptorArray(source.evidence, 512).map(raw => {
      const item = descriptorRecord(raw, [
        'edgeId', 'from', 'to', 'figureId', 'panelId', 'editedAt'
      ], ['edgeId', 'from', 'to', 'figureId', 'panelId', 'editedAt']);
      return {
        edgeId: safeMechanismId(item.edgeId, 80, strictCanonical),
        from: safeMechanismId(item.from, 80, strictCanonical),
        to: safeMechanismId(item.to, 80, strictCanonical),
        figureId: safeMechanismId(item.figureId, 160, strictCanonical),
        panelId: safeMechanismId(item.panelId, 32, strictCanonical),
        editedAt: safeReviewTimestamp(item.editedAt)
      };
    }), item => `${item.edgeId}\u0000${item.from}\u0000${item.to}` +
      `\u0000${item.figureId}\u0000${item.panelId}`);
    if (strictCanonical && evidence.some(item =>
      !/^[A-Z][A-Z0-9_-]*$/u.test(item.panelId))) invalidImport();
    return { nodes, edges, evidence };
  }

  function readSafeMechanismChain(value, options = {}) {
    const strictCanonical = options.strictCanonical === true;
    const source = descriptorRecord(value, [
      'initialized', 'nodes', 'edges', 'panelAliases', 'reviewTombstones',
      'layoutPreferences', 'generationIssues'
    ], strictCanonical
      ? ['nodes', 'edges', 'panelAliases', 'reviewTombstones']
      : ['nodes', 'edges']);
    const nodes = descriptorArray(source.nodes, MAX_NODES).map(item => {
      const node = descriptorRecord(item, ['id', 'label'], ['id', 'label']);
      return {
        id: safeMechanismId(node.id, 80, strictCanonical),
        label: safeEditable(node.label, 4000, strictCanonical)
      };
    });
    const nodeIds = new Set(nodes.map(node => node.id));
    if (nodeIds.size !== nodes.length) invalidImport();
    const edgeIds = new Set();
    const signatures = new Set();
    const edges = descriptorArray(source.edges, MAX_EDGES).map(item => {
      const edge = descriptorRecord(item, [
        'id', 'from', 'to', 'label', 'polarity', 'panelEvidence',
        'humanReviewed', 'editedAt'
      ], strictCanonical
        ? ['id', 'from', 'to', 'label', 'polarity', 'panelEvidence',
          'humanReviewed', 'editedAt']
        : ['id', 'from', 'to', 'label']);
      const id = safeMechanismId(edge.id, 80, strictCanonical);
      const from = safeMechanismId(edge.from, 80, strictCanonical);
      const to = safeMechanismId(edge.to, 80, strictCanonical);
      const polarity = Object.hasOwn(edge, 'polarity') ? edge.polarity : 'neutral';
      if (!nodeIds.has(from) || !nodeIds.has(to) ||
          !['neutral', 'positive', 'negative'].includes(polarity) ||
          (from === to && polarity === 'neutral') || edgeIds.has(id)) invalidImport();
      edgeIds.add(id);
      const label = safeEditable(edge.label, 4000, strictCanonical);
      const signature = `${from}\u0000${to}\u0000${polarity}\u0000${label.value}`;
      if (signatures.has(signature) && options.allowParallelEdges !== true) invalidImport();
      signatures.add(signature);
      const result = {
        id, from, to, label, polarity,
        panelEvidence: Object.hasOwn(edge, 'panelEvidence')
          ? descriptorArray(edge.panelEvidence, 32)
            .map(item => safePanelEvidence(item, strictCanonical)) : [],
        humanReviewed: Object.hasOwn(edge, 'humanReviewed')
          ? edge.humanReviewed : false,
        editedAt: Object.hasOwn(edge, 'editedAt') ? edge.editedAt : 0
      };
      if (Object.hasOwn(edge, 'humanReviewed')) {
        if (typeof edge.humanReviewed !== 'boolean') invalidImport();
      }
      if (Object.hasOwn(edge, 'editedAt')) {
        safeReviewTimestamp(edge.editedAt);
      }
      return result;
    });
    const result = { nodes, edges };
    if (Object.hasOwn(source, 'panelAliases')) {
      const aliases = source.panelAliases;
      if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) invalidImport();
      let prototype;
      let names;
      let symbols;
      try {
        prototype = Object.getPrototypeOf(aliases);
        names = Object.getOwnPropertyNames(aliases);
        symbols = Object.getOwnPropertySymbols(aliases);
      } catch (_) {
        invalidImport();
      }
      if ((prototype !== Object.prototype && prototype !== null) ||
          symbols.length || names.length > 512 ||
          names.some(key => BLOCKED_KEYS.has(key))) invalidImport();
      const panelAliases = {};
      names.forEach(key => {
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(aliases, key); }
        catch (_) { invalidImport(); }
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalidImport();
        const safeKey = safeMechanismText(key, 260, strictCanonical);
        if (!safeKey || safeKey !== key || !safeKey.includes(':')) invalidImport();
        const separator = safeKey.lastIndexOf(':');
        if (strictCanonical && (safeMechanismId(
          safeKey.slice(0, separator), 160, true
        ) !== safeKey.slice(0, separator) ||
          !/^[A-Z][A-Z0-9_-]*$/u.test(safeKey.slice(separator + 1)))) invalidImport();
        panelAliases[safeKey] = safeEditable(
          descriptor.value, 4000, strictCanonical
        );
      });
      result.panelAliases = panelAliases;
    }
    if (Object.hasOwn(source, 'reviewTombstones')) {
      result.reviewTombstones = safeMechanismReviewTombstones(
        source.reviewTombstones, strictCanonical
      );
    }
    if (!Object.hasOwn(source, 'panelAliases')) result.panelAliases = {};
    if (!Object.hasOwn(source, 'reviewTombstones')) {
      result.reviewTombstones = { nodes: [], edges: [], evidence: [] };
    }
    if (Object.hasOwn(source, 'initialized')) {
      if (typeof source.initialized !== 'boolean' ||
          (strictCanonical && source.initialized !== true)) invalidImport();
      result.initialized = source.initialized;
    } else if (strictCanonical && (nodes.length || edges.length)) {
      invalidImport();
    } else if (!strictCanonical && (nodes.length || edges.length)) {
      result.initialized = true;
    }
    const layoutPreferences = safeLayoutPreferences(
      source.layoutPreferences, nodeIds, strictCanonical
    );
    if (layoutPreferences) result.layoutPreferences = layoutPreferences;
    if (Object.hasOwn(source, 'generationIssues')) {
      const generationIssues = descriptorArray(source.generationIssues, 16).map(item => {
        const issue = descriptorRecord(item, [
          'code', 'message', 'edgeIndex', 'edgeId', 'displayId'
        ], ['code', 'message', 'edgeId', 'displayId']);
        if (!Number.isSafeInteger(issue.edgeIndex) || issue.edgeIndex < -1 ||
            issue.edgeIndex >= MAX_EDGES) invalidImport();
        const code = safeMechanismText(issue.code, 80, strictCanonical);
        const message = safeMechanismText(issue.message, 240, strictCanonical);
        const edgeId = safeMechanismId(issue.edgeId, 80, strictCanonical);
        const displayId = safeMechanismText(issue.displayId, 193, strictCanonical);
        if (!code || !message || !edgeId || !displayId) invalidImport();
        if (strictCanonical) {
          let canonicalDisplay = false;
          try {
            canonicalDisplay = figureWorkspaceContractMethod(
              'isCanonicalMechanismWorkspacePanelReference'
            )(displayId) === true;
          } catch (_) {}
          if (!canonicalDisplay) invalidImport();
        }
        return {
          code,
          message,
          edgeIndex: issue.edgeIndex,
          edgeId,
          displayId
        };
      });
      if (strictCanonical && !generationIssues.length) invalidImport();
      if (strictCanonical && result.initialized !== true) invalidImport();
      result.generationIssues = generationIssues;
    }
    return result;
  }

  function safeCanonicalUrl(value) {
    const text = typeof value === 'string' && value.length <= 4096 ? value : '';
    let parsed;
    try { parsed = new URL(text); }
    catch (_) { invalidImport(); }
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol) ||
        parsed.username || parsed.password) invalidImport();
    parsed.hash = '';
    return parsed.toString();
  }

  function readSafePaperIdentityV1(value) {
    const source = descriptorRecord(value, [
      'workspaceId', 'workspaceGeneration', 'canonicalUrl', 'contentHash',
      'documentId', 'title'
    ], ['workspaceId', 'workspaceGeneration', 'canonicalUrl', 'contentHash']);
    const workspaceId = safeExportId(source.workspaceId);
    const contentHash = typeof source.contentHash === 'string'
      ? source.contentHash.toLowerCase() : '';
    if (!/^workspace:[a-f0-9]{64}$/u.test(workspaceId.toLowerCase()) ||
        !Number.isSafeInteger(source.workspaceGeneration) ||
        source.workspaceGeneration < 1 || !/^[a-f0-9]{64}$/u.test(contentHash)) {
      invalidImport();
    }
    const result = {
      workspaceId,
      workspaceGeneration: source.workspaceGeneration,
      canonicalUrl: safeCanonicalUrl(source.canonicalUrl),
      contentHash
    };
    if (Object.hasOwn(source, 'documentId')) {
      result.documentId = safeExportId(source.documentId);
    }
    if (Object.hasOwn(source, 'title')) result.title = safeExportText(source.title, 500);
    return result;
  }

  function readSafePaperIdentityV2(value, options = {}) {
    const strictCanonical = options.strictCanonical !== false;
    const source = descriptorRecord(value, [
      'workspaceId', 'workspaceGeneration', 'contentHash', 'documentId', 'title',
      ...(options.allowCanonicalUrl === true ? ['canonicalUrl'] : [])
    ], ['workspaceId', 'workspaceGeneration', 'contentHash']);
    const workspaceId = safeExportId(source.workspaceId, 200, strictCanonical);
    const contentHash = typeof source.contentHash === 'string'
      ? source.contentHash : '';
    if (!/^workspace:[a-f0-9]{64}$/u.test(workspaceId.toLowerCase()) ||
        !Number.isSafeInteger(source.workspaceGeneration) ||
        source.workspaceGeneration < 1 || !/^[a-f0-9]{64}$/u.test(contentHash)) {
      invalidImport();
    }
    const result = {
      workspaceId,
      workspaceGeneration: source.workspaceGeneration,
      contentHash
    };
    if (Object.hasOwn(source, 'documentId')) {
      result.documentId = safeExportId(source.documentId, 200, strictCanonical);
    }
    if (Object.hasOwn(source, 'title')) {
      const title = safeExportText(source.title, 500, strictCanonical);
      if (!title) invalidImport();
      result.title = title;
    }
    return result;
  }

  function readExpectedPaperIdentity(value) {
    const property = key => {
      const descriptor = ownDataProperty(value, key);
      if (!descriptor.readable || !descriptor.present) invalidImport();
      return descriptor.value;
    };
    const workspaceId = safeExportId(property('workspaceId'));
    const workspaceGeneration = property('workspaceGeneration');
    const contentHashValue = property('contentHash');
    const contentHash = typeof contentHashValue === 'string'
      ? contentHashValue.toLowerCase() : '';
    if (!/^workspace:[a-f0-9]{64}$/u.test(workspaceId.toLowerCase()) ||
        !Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1 ||
        !/^[a-f0-9]{64}$/u.test(contentHash)) invalidImport();
    const document = ownDataProperty(value, 'documentId');
    if (!document.readable) invalidImport();
    const canonical = ownDataProperty(value, 'canonicalUrl');
    if (!canonical.readable) invalidImport();
    return {
      workspaceId, workspaceGeneration, contentHash,
      ...(document.present ? { documentId: safeExportId(document.value) } : {}),
      ...(canonical.present ? { canonicalUrl: safeCanonicalUrl(canonical.value) } : {})
    };
  }

  function isCanonicalGenerationDigest(value) {
    const prefix = 'mechanism-envelope-v1-';
    if (typeof value !== 'string' || !value.startsWith(prefix)) return false;
    const encoded = value.slice(prefix.length);
    if (encoded.length < 64 || encoded.length > 72) return false;
    const lane8 = token => /^[0-7][a-f0-9]{7}$/u.test(token) ||
      /^0{0,6}-[1-9a-f][a-f0-9]{0,6}$/u.test(token);
    const lane9 = token => /^-(?:[1-7][a-f0-9]{7}|80000000)$/u.test(token);
    const visit = (lane, offset) => {
      if (lane === 8) return offset === encoded.length;
      const eight = encoded.slice(offset, offset + 8);
      if (eight.length === 8 && lane8(eight) && visit(lane + 1, offset + 8)) {
        return true;
      }
      const nine = encoded.slice(offset, offset + 9);
      return nine.length === 9 && lane9(nine) && visit(lane + 1, offset + 9);
    };
    return visit(0, 0);
  }

  function safeCanonicalDurableGeneration(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || !value ||
        value.length > MAX_MECHANISM_GENERATION_LENGTH) invalidImport();
    let parsed;
    try { parsed = JSON.parse(value); } catch (_) { invalidImport(); }
    const source = descriptorRecord(parsed, [
      'schemaVersion', 'envelopeKind', 'status', 'evidenceFirstVersions',
      'identity', 'committedWorkspaceRevision', 'preview', 'updatedAt',
      'projectionDigest', 'chainProjectionDigest'
    ], [
      'schemaVersion', 'envelopeKind', 'status', 'evidenceFirstVersions',
      'identity', 'committedWorkspaceRevision', 'preview', 'updatedAt',
      'projectionDigest', 'chainProjectionDigest'
    ]);
    if (source.schemaVersion !== 1 || source.envelopeKind !== 'durable' ||
        source.status !== 'complete' || !source.evidenceFirstVersions ||
        typeof source.evidenceFirstVersions !== 'object' || !source.identity ||
        typeof source.identity !== 'object' || !source.preview ||
        typeof source.preview !== 'object' ||
        !Number.isSafeInteger(source.committedWorkspaceRevision) ||
        source.committedWorkspaceRevision < 1 ||
        !Number.isSafeInteger(source.updatedAt) || source.updatedAt < 0 ||
        !isCanonicalGenerationDigest(source.projectionDigest) ||
        !isCanonicalGenerationDigest(source.chainProjectionDigest) ||
        JSON.stringify(parsed) !== value) invalidImport();
    descriptorRecord(source.identity, [
      'operationId', 'operationEpoch', 'documentId', 'workspaceId',
      'workspaceGeneration', 'workspaceLifecycle', 'baseWorkspaceRevision',
      'mechanismChainFingerprint'
    ], [
      'operationId', 'operationEpoch', 'documentId', 'workspaceId',
      'workspaceGeneration', 'workspaceLifecycle', 'baseWorkspaceRevision',
      'mechanismChainFingerprint'
    ]);
    descriptorRecord(source.preview, [
      'status', 'canonicalDigest', 'nodes', 'relations', 'claims',
      'claimUsages', 'nodeEvidence', 'nonGraphEvidence', 'unresolvedClaims',
      'panelDispositions'
    ], ['status', 'canonicalDigest', 'nodes', 'relations', 'claims']);
    let authoritative;
    try {
      authoritative = figureWorkspaceContractMethod(
        'readMechanismGenerationEnvelope'
      )(value);
    } catch (_) {
      authoritative = null;
    }
    if (!authoritative || authoritative.envelopeKind !== 'durable' ||
        JSON.stringify(authoritative) !== value) invalidImport();
    return value;
  }

  function createMechanismNetworkJson(options) {
    const source = descriptorRecord(options, [
      'chain', 'paper', 'exportedAt', 'mechanismGeneration'
    ], [
      'chain', 'paper'
    ]);
    const rawDate = Object.hasOwn(source, 'exportedAt') ? source.exportedAt : Date.now();
    if (typeof rawDate !== 'string' && typeof rawDate !== 'number') invalidImport();
    const date = new Date(rawDate);
    if (!Number.isFinite(date.getTime())) invalidImport();
    const mechanismGeneration = Object.hasOwn(source, 'mechanismGeneration')
      ? safeCanonicalDurableGeneration(source.mechanismGeneration) : null;
    return {
      schema: MECHANISM_NETWORK_EXPORT_SCHEMA,
      schemaVersion: MECHANISM_NETWORK_EXPORT_VERSION,
      exportedAt: date.toISOString(),
      paper: readSafePaperIdentityV2(source.paper, { allowCanonicalUrl: true }),
      mechanismChain: readSafeMechanismChain(source.chain, {
        allowParallelEdges: mechanismGeneration !== null,
        strictCanonical: true
      }),
      mechanismGeneration
    };
  }

  function parseMechanismNetworkJson(input, expectedPaper) {
    let parsed = input;
    if (typeof input === 'string') {
      if (input.length > 2_000_000) invalidImport();
      try { parsed = JSON.parse(input); }
      catch (_) { invalidImport(); }
    }
    const identity = descriptorRecord(parsed, [
      'schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain',
      'mechanismGeneration'
    ], ['schema', 'schemaVersion']);
    if (identity.schema !== MECHANISM_NETWORK_EXPORT_SCHEMA) invalidImport();
    const expected = readExpectedPaperIdentity(expectedPaper);
    let root;
    let paper;
    let mechanismGeneration = null;
    if (identity.schemaVersion === MECHANISM_NETWORK_EXPORT_VERSION) {
      root = descriptorRecord(parsed, [
        'schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain',
        'mechanismGeneration'
      ], [
        'schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain',
        'mechanismGeneration'
      ]);
      paper = readSafePaperIdentityV2(root.paper);
      mechanismGeneration = safeCanonicalDurableGeneration(root.mechanismGeneration);
    } else if (identity.schemaVersion === MECHANISM_NETWORK_LEGACY_VERSION) {
      root = descriptorRecord(parsed, [
        'schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain'
      ], ['schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain']);
      paper = readSafePaperIdentityV1(root.paper);
    } else {
      invalidImport();
    }
    if (typeof root.exportedAt !== 'string' ||
        !Number.isFinite(new Date(root.exportedAt).getTime())) invalidImport();
    const keys = ['workspaceId', 'workspaceGeneration', 'contentHash'];
    if (keys.some(key => paper[key] !== expected[key]) ||
        (root.schemaVersion === MECHANISM_NETWORK_LEGACY_VERSION &&
          (!expected.canonicalUrl || paper.canonicalUrl !== expected.canonicalUrl)) ||
        (paper.documentId && paper.documentId !== expected.documentId)) {
      throw mechanismNetworkError('MECHANISM_NETWORK_IMPORT_PAPER_MISMATCH');
    }
    return {
      schemaVersion: root.schemaVersion,
      paper,
      mechanismChain: readSafeMechanismChain(root.mechanismChain, {
        allowParallelEdges: mechanismGeneration !== null,
        strictCanonical: root.schemaVersion === MECHANISM_NETWORK_EXPORT_VERSION
      }),
      mechanismGeneration
    };
  }

  function classifyMechanismNetworkJson(input) {
    let parsed = input;
    if (typeof input === 'string') {
      if (input.length > 2_000_000) invalidImport();
      try { parsed = JSON.parse(input); } catch (_) { invalidImport(); }
    }
    const schema = ownDataProperty(parsed, 'schema');
    const version = ownDataProperty(parsed, 'schemaVersion');
    if (!schema.readable || !schema.present || !version.readable || !version.present) {
      invalidImport();
    }
    if (schema.value === MECHANISM_NETWORK_EXPORT_SCHEMA &&
        [MECHANISM_NETWORK_LEGACY_VERSION, MECHANISM_NETWORK_EXPORT_VERSION]
          .includes(version.value)) {
      const paper = ownDataProperty(parsed, 'paper');
      if (!paper.readable || !paper.present) invalidImport();
      parseMechanismNetworkJson(parsed, paper.value);
      return { kind: 'workspace', schemaVersion: version.value };
    }
    if (schema.value === 'brevess.mechanism-graph' && version.value === 1) {
      return { kind: 'legacy_graph', schemaVersion: 1 };
    }
    invalidImport();
  }

  function escapeXml(value) {
    return String(value).replace(/[&<>"']/gu, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[character]));
  }

  function safeLayoutNumber(value, maximum = 20000) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        value > maximum) invalidImport();
    return Math.round(value * 100) / 100;
  }

  function safeSvgPath(value) {
    if (typeof value !== 'string' || value.length > 4000 ||
        !/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\s]+$/u.test(value)) invalidImport();
    return value;
  }

  function serializeMechanismNetworkSvg(options) {
    const source = descriptorRecord(options, ['chain', 'layout', 'title'], [
      'chain', 'layout'
    ]);
    const chain = readSafeMechanismChain(source.chain);
    const title = Object.hasOwn(source, 'title') ? safeExportText(source.title, 500) : '';
    const layoutSource = descriptorRecord(source.layout, [
      'width', 'height', 'nodes', 'edges', 'components'
    ], ['width', 'height', 'nodes', 'edges']);
    const width = safeLayoutNumber(layoutSource.width);
    const graphHeight = safeLayoutNumber(layoutSource.height);
    const titleOffset = title ? 48 : 20;
    const height = graphHeight + titleOffset + 24;
    const nodeLayout = new Map(descriptorArray(layoutSource.nodes, MAX_NODES).map(item => {
      const node = descriptorRecord(item, [
        'id', 'x', 'y', 'width', 'height', 'rank', 'componentId'
      ], ['id', 'x', 'y', 'width', 'height']);
      const id = safeExportId(node.id);
      return [id, {
        id,
        x: safeLayoutNumber(node.x), y: safeLayoutNumber(node.y),
        width: safeLayoutNumber(node.width), height: safeLayoutNumber(node.height)
      }];
    }));
    const edgeLayout = new Map(descriptorArray(layoutSource.edges, MAX_EDGES).map(item => {
      const edge = descriptorRecord(item, [
        'id', 'from', 'to', 'path', 'hitPath', 'labelX', 'labelY', 'endX',
        'endY', 'feedback', 'selfLoop', 'polarity'
      ], ['id', 'from', 'to', 'path', 'labelX', 'labelY']);
      return [safeExportId(edge.id), {
        path: safeSvgPath(edge.path),
        labelX: safeLayoutNumber(edge.labelX),
        labelY: safeLayoutNumber(edge.labelY),
        feedback: edge.feedback === true,
        selfLoop: edge.selfLoop === true
      }];
    }));
    const colors = { neutral: '#52778b', positive: '#b4413d', negative: '#2866a5' };
    const body = [];
    if (title) body.push(`<text x="24" y="28" class="title">${escapeXml(title)}</text>`);
    const offset = titleOffset;
    chain.edges.forEach(edge => {
      const routed = edgeLayout.get(edge.id);
      if (!routed) invalidImport();
      const dash = edge.polarity === 'negative' ? ' stroke-dasharray="7 5"' : '';
      body.push(`<path d="${escapeXml(routed.path)}" transform="translate(0 ${offset})" ` +
        `stroke="${colors[edge.polarity]}"${dash} marker-end="url(#${edge.polarity === 'neutral'
          ? 'mechanism-arrow' : `mechanism-arrow-${edge.polarity}`})" ` +
        `aria-label="${escapeXml(`${edge.polarity} ${edge.from} to ${edge.to}`)}"/>`);
      const label = edge.label.value || (edge.polarity === 'positive' ? '正向' :
        edge.polarity === 'negative' ? '负向' : '联系');
      body.push(`<text x="${routed.labelX}" y="${routed.labelY + offset}" ` +
        `class="edge-label">${escapeXml(label)}</text>`);
      if (routed.feedback && edge.polarity !== 'neutral') {
        body.push(`<text x="${routed.labelX}" y="${routed.labelY + offset + 14}" ` +
          `class="polarity-label">${edge.polarity === 'negative' ? '负反馈' : '正反馈'}</text>`);
      }
    });
    chain.nodes.forEach(node => {
      const placed = nodeLayout.get(node.id);
      if (!placed) invalidImport();
      body.push(`<rect x="${placed.x}" y="${placed.y + offset}" width="${placed.width}" ` +
        `height="${placed.height}" rx="12" class="node"/>`);
      body.push(`<text x="${placed.x + placed.width / 2}" ` +
        `y="${placed.y + offset + placed.height / 2 + 4}" class="node-label">` +
        `${escapeXml(node.label.value || '未填写节点')}</text>`);
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" role="img">` +
      `<style>text{font-family:Arial,"Noto Sans SC",sans-serif}.title{font-size:18px;font-weight:700;fill:#173c52}.node{fill:#fff;stroke:#c6d9e4;stroke-width:1}.node-label{font-size:12px;font-weight:700;fill:#173c52;text-anchor:middle}.edge-label{font-size:10px;font-weight:700;fill:#365d72;text-anchor:middle}.polarity-label{font-size:9px;fill:#526b79;text-anchor:middle}path{fill:none;stroke-width:1.5;stroke-linecap:round}</style>` +
      `<defs>` + Object.entries(colors).map(([polarity, color]) =>
        `<marker id="mechanism-arrow-${polarity}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`
      ).join('').replace('id="mechanism-arrow-neutral"', 'id="mechanism-arrow"') +
      `</defs>${body.join('')}</svg>`;
  }

  function serializeMechanismAuditSvg(options) {
    const source = descriptorRecord(options, ['graph', 'layout'], ['graph', 'layout']);
    const graph = readGraphExportDto(source.graph);
    if (!graph) invalidImport();
    const layoutSource = descriptorRecord(source.layout, [
      'width', 'height', 'nodes', 'edges', 'components'
    ], ['width', 'height', 'nodes', 'edges']);
    const width = safeLayoutNumber(layoutSource.width);
    const height = safeLayoutNumber(layoutSource.height) + 44;
    const nodeLayout = new Map(descriptorArray(layoutSource.nodes, MAX_NODES).map(raw => {
      const node = descriptorRecord(raw, [
        'id', 'x', 'y', 'width', 'height', 'rank', 'componentId'
      ], ['id', 'x', 'y', 'width', 'height']);
      const id = safeExportId(node.id);
      return [id, {
        x: safeLayoutNumber(node.x), y: safeLayoutNumber(node.y),
        width: safeLayoutNumber(node.width), height: safeLayoutNumber(node.height)
      }];
    }));
    const edgeLayout = new Map(descriptorArray(layoutSource.edges, MAX_EDGES).map(raw => {
      const edge = descriptorRecord(raw, [
        'id', 'from', 'to', 'path', 'hitPath', 'labelX', 'labelY', 'endX',
        'endY', 'feedback', 'selfLoop', 'polarity'
      ], ['id', 'from', 'to', 'path', 'labelX', 'labelY']);
      return [safeExportId(edge.id), {
        path: safeSvgPath(edge.path),
        labelX: safeLayoutNumber(edge.labelX),
        labelY: safeLayoutNumber(edge.labelY)
      }];
    }));
    const body = [];
    for (const edge of graph.edges) {
      const routed = edgeLayout.get(edge.id);
      if (!routed) invalidImport();
      const dash = edge.lineStyle === 'dashed' ? ' stroke-dasharray="7 5"' : '';
      const correlation = edge.lineStyle === 'dashed' ? ' correlation-only' : '';
      const contested = edge.contested ? ' contested' : '';
      const marker = edge.lineStyle === 'dashed'
        ? 'audit-arrow-correlation' : 'audit-arrow';
      body.push(`<path d="${escapeXml(routed.path)}" transform="translate(0 20)" ` +
        `class="mechanism-edge${correlation}${contested}" ` +
        `data-line-style="${edge.lineStyle}" data-contested="${edge.contested}"${dash} ` +
        `marker-end="url(#${marker})"/>`);
      body.push(`<text x="${routed.labelX}" y="${routed.labelY + 16}" ` +
        `class="edge-label${contested}">${escapeXml(
          edge.contested ? `contested: ${edge.label}` : edge.label
        )}</text>`);
    }
    for (const node of graph.nodes) {
      const placed = nodeLayout.get(node.id);
      if (!placed) invalidImport();
      body.push(`<rect x="${placed.x}" y="${placed.y + 20}" width="${placed.width}" ` +
        `height="${placed.height}" rx="12" class="node"/>`);
      body.push(`<text x="${placed.x + placed.width / 2}" ` +
        `y="${placed.y + placed.height / 2 + 24}" class="node-label">` +
        `${escapeXml(node.label)}</text>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" role="img">` +
      `<style>text{font-family:Arial,"Noto Sans SC",sans-serif}.node{fill:#fff;stroke:#c6d9e4}.node-label{font-size:12px;font-weight:700;fill:#173c52;text-anchor:middle}.edge-label{font-size:10px;font-weight:700;fill:#354f5e;text-anchor:middle}.edge-label.contested{fill:#7a4d00}.mechanism-edge{fill:none;stroke:#354f5e;stroke-width:1.7}.mechanism-edge.correlation-only{stroke:#111}.mechanism-edge.contested{stroke:#8b5c20;stroke-width:3}</style>` +
      `<defs><marker id="audit-arrow" viewBox="0 0 10 10" refX="9" refY="5" ` +
      `markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" ` +
      `fill="#354f5e"/></marker><marker id="audit-arrow-correlation" ` +
      `viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ` +
      `orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#111"/></marker>` +
      `</defs>${body.join('')}</svg>`;
  }

  function createMechanismNetworkPngPlan(layout, options = {}) {
    const rawScale = ownDataValue(options, 'scale');
    const scale = typeof rawScale === 'number' && Number.isFinite(rawScale)
      ? Math.max(1, Math.min(3, rawScale)) : 2;
    const rawWidth = ownDataValue(layout, 'width');
    const rawHeight = ownDataValue(layout, 'height');
    const width = typeof rawWidth === 'number' ? Math.ceil(rawWidth * scale) : 0;
    const height = typeof rawHeight === 'number' ? Math.ceil(rawHeight * scale) : 0;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 1 || height < 1 || width > 16384 || height > 16384 ||
        width * height > 32_000_000) {
      throw mechanismNetworkError('MECHANISM_NETWORK_PNG_TOO_LARGE');
    }
    return { scale, width, height, pixels: width * height };
  }

  return {
    findMechanismStrongComponents,
    mechanismNetworkFocusSet,
    createMechanismNetworkLayout,
    createMechanismLayoutCache,
    mechanismEdgeAccessibleName,
    createMechanismFrameScheduler,
    createMechanismNetworkJson,
    parseMechanismNetworkJson,
    classifyMechanismNetworkJson,
    serializeMechanismNetworkSvg,
    createMechanismNetworkPngPlan,
    createMechanismMermaidDefinition,
    createMechanismEvidenceMatrix,
    normalizeMechanismEvidenceCode,
    createMechanismAuditEvidenceMatrix,
    createMechanismAuditEvidenceView,
    createMechanismGraphExportDto,
    createMechanismAuditMermaidDefinition,
    serializeMechanismAuditSvg,
    MECHANISM_NETWORK_EXPORT_SCHEMA,
    MECHANISM_NETWORK_EXPORT_VERSION
  };
});
