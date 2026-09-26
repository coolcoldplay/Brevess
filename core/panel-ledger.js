(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PANEL_LEDGER_VERSION = '1';
  const PANEL_STATUSES = new Set(['unreviewed', 'linked', 'unlinked', 'excluded', 'ambiguous']);
  const MAX_FIGURES = 128;
  const MAX_PANELS = 512;
  const MAX_SOURCES = 12;
  const MAX_EDGE_IDS = 64;
  const MAX_CANDIDATES = 24;
  const MAX_EDGES = 256;
  const MAX_ASSIGNMENTS_PER_EDGE = 512;
  const MAX_ASSIGNMENTS = 4096;

  function ledgerError(code) {
    return Object.assign(new Error(code), { code });
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object';
  }

  function ownData(value, key) {
    if (!isRecord(value)) return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? descriptor.value : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function hasOwn(value, key) {
    if (!isRecord(value)) return false;
    try { return Object.getOwnPropertyDescriptor(value, key) !== undefined; } catch (_) { return false; }
  }

  function firstOwnData(value, keys) {
    for (const key of keys) {
      const candidate = ownData(value, key);
      if (candidate !== undefined && candidate !== null) return candidate;
    }
    return undefined;
  }

  function ownKeys(value) {
    if (!isRecord(value)) return [];
    try { return Object.keys(value); } catch (_) { return []; }
  }

  function clean(value, maxLength) {
    if (!['string', 'number'].includes(typeof value)) return '';
    return String(value).normalize('NFKC')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function safeFigureId(value) {
    const id = clean(value, 80).toLowerCase();
    return /^(?:figure-(?:(?:s)?\d+|ed\d+)(?:-[a-z0-9]+)*|supp-[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(id)
      ? id : '';
  }

  function safePanelId(value) {
    const id = clean(value, 16).replace(/^\(?\s*panels?\s*/i, '')
      .replace(/[()\s._:/\\]+/g, '').toUpperCase();
    return /^(?:[A-Z]\d{0,2}|\d{1,2})$/.test(id) ? id : '';
  }

  function expandPanelReference(value) {
    const text = clean(value, 32).replace(/[\u2012-\u2015]/g, '-')
      .replace(/^\(?\s*panels?\s*/i, '').replace(/\)?$/u, '').trim();
    const single = safePanelId(text);
    if (single) return [single];
    const range = text.match(/^([A-Za-z])-([A-Za-z])$/u);
    if (!range) return [];
    const start = range[1].toUpperCase().charCodeAt(0);
    const end = range[2].toUpperCase().charCodeAt(0);
    if (end < start || end - start > 25) return [];
    return Array.from({ length: end - start + 1 }, (_, index) => String.fromCharCode(start + index));
  }

  function panelKey(figureId, panelId) {
    const figure = safeFigureId(figureId);
    const panel = safePanelId(panelId);
    return figure && panel ? `${figure}:${panel}` : '';
  }

  function canonicalFigureDisplayId(figureId) {
    const figure = safeFigureId(figureId);
    if (!figure) return '';
    let match = figure.match(/^figure-(\d+)/u);
    if (match) return `${Number(match[1])}`;
    match = figure.match(/^figure-s(\d+)/u);
    if (match) return `S${Number(match[1])}`;
    match = figure.match(/^figure-ed(\d+)/u);
    if (match) return `ED${Number(match[1])}`;
    match = figure.match(/(?:^|-)s(\d+)$/u);
    if (match && figure.startsWith('supp-')) return `S${Number(match[1])}`;
    match = figure.match(/(?:^|-)figure-(\d+)$/u);
    if (match && figure.startsWith('supp-')) return `S${Number(match[1])}`;
    return '';
  }

  function boundedStringArray(value, limit, maxLength, overflowCode) {
    if (!Array.isArray(value)) return [];
    if (value.length > limit) throw ledgerError(overflowCode);
    const output = [];
    const seen = new Set();
    for (let index = 0; index < value.length; index += 1) {
      const normalized = clean(ownData(value, String(index)), maxLength);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(normalized);
    }
    return output;
  }

  function normalizeCandidateKey(value) {
    const candidate = clean(value, 100);
    const separator = candidate.indexOf(':');
    if (separator <= 0 || candidate.indexOf(':', separator + 1) !== -1) return '';
    const normalized = panelKey(candidate.slice(0, separator), candidate.slice(separator + 1));
    return normalized === candidate ? normalized : '';
  }

  function normalizeReview(raw, key, allowedKeys) {
    const status = clean(ownData(raw, 'status'), 24).toLowerCase();
    const hasReason = hasOwn(raw, 'reason');
    const hasStatusReason = hasOwn(raw, 'statusReason');
    const hasEdgeIds = hasOwn(raw, 'edgeIds');
    const hasCandidates = hasOwn(raw, 'candidatePanelKeys');
    const rawReason = firstOwnData(raw, ['statusReason', 'reason']);
    const rawEdgeIds = ownData(raw, 'edgeIds');
    const rawCandidates = ownData(raw, 'candidatePanelKeys');
    const invalidTypes = ((hasReason || hasStatusReason) && typeof rawReason !== 'string') ||
      (hasReason && hasStatusReason) || (hasEdgeIds && !Array.isArray(rawEdgeIds)) ||
      (hasCandidates && !Array.isArray(rawCandidates));
    if (status === 'unreviewed') {
      return {
        valid: !invalidTypes && !hasReason && !hasStatusReason && !hasEdgeIds && !hasCandidates,
        status
      };
    }
    if (!PANEL_STATUSES.has(status) || invalidTypes) {
      return { valid: false, status: 'unreviewed' };
    }
    let edgeIds;
    let candidates;
    try {
      edgeIds = boundedStringArray(rawEdgeIds, MAX_EDGE_IDS, 120,
        'PANEL_LEDGER_EDGE_ID_LIMIT');
      candidates = boundedStringArray(rawCandidates, MAX_CANDIDATES, 100,
        'PANEL_LEDGER_CANDIDATE_LIMIT').map(normalizeCandidateKey).filter(Boolean);
    } catch (_) {
      return { valid: false, status: 'unreviewed' };
    }
    const reason = clean(rawReason, 600);
    if (status === 'linked' && (!hasEdgeIds || !edgeIds.length ||
        edgeIds.length !== rawEdgeIds.length || hasReason || hasStatusReason || hasCandidates)) {
      return { valid: false, status: 'unreviewed' };
    }
    if ((status === 'unlinked' || status === 'excluded') &&
        (!reason || hasEdgeIds || hasCandidates)) return { valid: false, status: 'unreviewed' };
    if (status === 'ambiguous') {
      if (hasEdgeIds || candidates.length !== (Array.isArray(rawCandidates)
        ? rawCandidates.length : 0)) return { valid: false, status: 'unreviewed' };
      candidates = [...new Set(candidates)].filter(candidate =>
        candidate !== key && (!allowedKeys || allowedKeys.has(candidate)));
      if (candidates.length !== (Array.isArray(rawCandidates)
        ? rawCandidates.length : 0)) return { valid: false, status: 'unreviewed' };
      if (!reason && !candidates.length) return { valid: false, status: 'unreviewed' };
    }
    return { valid: true, status, reason, edgeIds, candidates };
  }

  function immutableEntry({
    figureId, panelId, sources, review, allowedKeys
  }) {
    const key = panelKey(figureId, panelId);
    if (!key) return null;
    const normalizedSources = boundedStringArray(sources, MAX_SOURCES, 120,
      'PANEL_LEDGER_SOURCE_LIMIT');
    const normalizedReview = review ? normalizeReview(review, key, allowedKeys)
      : { valid: true, status: 'unreviewed' };
    const accepted = normalizedReview.valid ? normalizedReview : { status: 'unreviewed' };
    const canonicalFigureDisplay = canonicalFigureDisplayId(figureId);
    const entry = {
      panelKey: key,
      figureId: safeFigureId(figureId),
      panelId: safePanelId(panelId),
      originalDisplayId: canonicalFigureDisplay
        ? `${canonicalFigureDisplay}${safePanelId(panelId)}`
        : `${safeFigureId(figureId).toUpperCase()}:${safePanelId(panelId)}`.slice(0, 100),
      displayAlias: clean(ownData(review, 'displayAlias'), 120),
      status: accepted.status,
      sources: Object.freeze(normalizedSources)
    };
    if (canonicalFigureDisplay) entry.figureDisplayId = canonicalFigureDisplay;
    if (accepted.reason) entry.statusReason = accepted.reason;
    if (accepted.edgeIds?.length) entry.edgeIds = Object.freeze([...accepted.edgeIds]);
    if (accepted.candidates?.length) entry.candidatePanelKeys = Object.freeze([...accepted.candidates]);
    return Object.freeze(entry);
  }

  function panelReference(value) {
    return isRecord(value) ? firstOwnData(value, ['panelId', 'panel_id', 'panel', 'id']) : value;
  }

  function assertPanelScan(state, amount) {
    state.scanned += Math.max(1, amount);
    if (state.scanned > MAX_PANELS) throw ledgerError('PANEL_LEDGER_PANEL_LIMIT');
  }

  function scanPanelCollection(value, add, source, state) {
    if (Array.isArray(value)) {
      if (value.length > MAX_PANELS) throw ledgerError('PANEL_LEDGER_PANEL_LIMIT');
      for (let index = 0; index < value.length; index += 1) {
        const ids = expandPanelReference(panelReference(ownData(value, String(index))));
        assertPanelScan(state, ids.length);
        for (const id of ids) add(id, source);
      }
      return;
    }
    if (!isRecord(value)) return;
    const keys = ownKeys(value);
    if (keys.length > MAX_PANELS) throw ledgerError('PANEL_LEDGER_PANEL_LIMIT');
    for (const rawId of keys) {
      const ids = expandPanelReference(rawId);
      assertPanelScan(state, ids.length);
      for (const id of ids) add(id, source);
    }
  }

  function buildPanelLedger(figures) {
    if (!Array.isArray(figures)) {
      return Object.freeze({ version: PANEL_LEDGER_VERSION, entries: Object.freeze([]) });
    }
    if (figures.length > MAX_FIGURES) throw ledgerError('PANEL_LEDGER_FIGURE_LIMIT');
    const entriesByKey = new Map();
    const state = { scanned: 0 };
    for (let index = 0; index < figures.length; index += 1) {
      const rawFigure = ownData(figures, String(index));
      const figureId = safeFigureId(firstOwnData(rawFigure, ['figureId', 'id']));
      if (!figureId) continue;
      const add = (panelId, source) => {
        const key = panelKey(figureId, panelId);
        if (!key) return;
        const existing = entriesByKey.get(key);
        entriesByKey.set(key, immutableEntry({
          figureId, panelId, sources: existing ? [...existing.sources, source] : [source]
        }));
        if (entriesByKey.size > MAX_PANELS) throw ledgerError('PANEL_LEDGER_PANEL_LIMIT');
      };
      scanPanelCollection(ownData(rawFigure, 'panelHints'), add, 'panelHints', state);
      const analysis = ownData(rawFigure, 'analysis');
      scanPanelCollection(ownData(analysis, 'panels'), add, 'analysis.panels', state);
      scanPanelCollection(ownData(rawFigure, 'panelAnalyses'), add, 'panelAnalyses', state);
      scanPanelCollection(ownData(analysis, 'panelAnalyses'), add, 'panelAnalyses', state);
      const chain = ownData(analysis, 'argumentChain');
      if (Array.isArray(chain)) {
        if (chain.length > MAX_PANELS) throw ledgerError('PANEL_LEDGER_PANEL_LIMIT');
        for (let step = 0; step < chain.length; step += 1) {
          scanPanelCollection(ownData(ownData(chain, String(step)), 'panels'), add,
            'analysis.argumentChain', state);
        }
      }
    }
    return Object.freeze({ version: PANEL_LEDGER_VERSION,
      entries: Object.freeze([...entriesByKey.values()]) });
  }

  function ledgerEntries(value) {
    return Array.isArray(value) ? value : ownData(value, 'entries');
  }

  function normalizePanelLedger(value) {
    const sourceEntries = ledgerEntries(value);
    if (!Array.isArray(sourceEntries)) {
      return Object.freeze({ version: PANEL_LEDGER_VERSION, entries: Object.freeze([]) });
    }
    if (sourceEntries.length > MAX_PANELS) throw ledgerError('PANEL_LEDGER_PANEL_LIMIT');
    const rawByKey = new Map();
    for (let index = 0; index < sourceEntries.length; index += 1) {
      const raw = ownData(sourceEntries, String(index));
      const figureId = safeFigureId(ownData(raw, 'figureId'));
      const panelId = safePanelId(ownData(raw, 'panelId'));
      const key = panelKey(figureId, panelId);
      if (!key || rawByKey.has(key)) continue;
      rawByKey.set(key, raw);
    }
    const allowedKeys = new Set(rawByKey.keys());
    const entries = [];
    for (const [key, raw] of rawByKey) {
      const separator = key.indexOf(':');
      const figureId = key.slice(0, separator);
      const panelId = key.slice(separator + 1);
      const entry = immutableEntry({
        figureId, panelId, sources: ownData(raw, 'sources'), review: raw, allowedKeys
      });
      if (entry) entries.push(entry);
    }
    return Object.freeze({ version: PANEL_LEDGER_VERSION, entries: Object.freeze(entries) });
  }

  function mergePanelLedgerReview(currentLedger, previousLedger) {
    const current = normalizePanelLedger(currentLedger);
    const previousEntries = ledgerEntries(previousLedger);
    if (Array.isArray(previousEntries) && previousEntries.length > MAX_PANELS) {
      throw ledgerError('PANEL_LEDGER_PANEL_LIMIT');
    }
    const previousByKey = new Map();
    if (Array.isArray(previousEntries)) {
      for (let index = 0; index < previousEntries.length; index += 1) {
        const item = ownData(previousEntries, String(index));
        const key = clean(ownData(item, 'panelKey'), 100);
        if (!key) continue;
        if (previousByKey.has(key)) throw ledgerError('PANEL_LEDGER_REVIEW_DUPLICATE');
        previousByKey.set(key, item);
      }
    }
    const allowedKeys = new Set(current.entries.map(entry => entry.panelKey));
    const entries = current.entries.map(entry => {
      const reviewed = previousByKey.get(entry.panelKey);
      if (!reviewed || ownData(reviewed, 'panelKey') !== entry.panelKey ||
          safeFigureId(ownData(reviewed, 'figureId')) !== entry.figureId ||
          safePanelId(ownData(reviewed, 'panelId')) !== entry.panelId) return entry;
      return immutableEntry({ figureId: entry.figureId, panelId: entry.panelId,
        sources: entry.sources, review: reviewed, allowedKeys });
    });
    return Object.freeze({ version: PANEL_LEDGER_VERSION, entries: Object.freeze(entries) });
  }

  function emptyAudit(ledger, overrides = {}) {
    return Object.freeze({
      ok: false, total: ledger.entries.length, covered: 0,
      missingPanelKeys: Object.freeze(ledger.entries.map(entry => entry.panelKey)),
      duplicatePanelKeys: Object.freeze([]), unknownPanelKeys: Object.freeze([]),
      unknownEdgeIds: Object.freeze([]), invalidPanelKeys: Object.freeze([]),
      malformed: false, limitExceeded: false, ...overrides
    });
  }

  function auditPanelCoverage(ledgerValue, result) {
    let ledger;
    try { ledger = normalizePanelLedger(ledgerValue); } catch (_) {
      return emptyAudit({ entries: [] }, { malformed: true, limitExceeded: true });
    }
    const dispositions = ownData(result, 'dispositions') ?? ownData(result, 'panelDispositions');
    const edges = ownData(result, 'edges');
    if (!Array.isArray(dispositions) || !Array.isArray(edges)) {
      return emptyAudit(ledger, { malformed: true });
    }
    if (dispositions.length > MAX_PANELS || edges.length > MAX_EDGES) {
      return emptyAudit(ledger, { malformed: true, limitExceeded: true });
    }
    const allowed = new Set(ledger.entries.map(entry => entry.panelKey));
    const counts = new Map();
    const dispositionByPanel = new Map();
    const unknownPanels = new Set();
    const unknownEdges = new Set();
    const invalidPanels = new Set();
    const edgeIds = new Set();
    const assignedByPanel = new Map();
    let malformed = false;
    let assignmentCount = 0;

    for (let index = 0; index < edges.length; index += 1) {
      const edge = ownData(edges, String(index));
      const edgeId = clean(firstOwnData(edge, ['edgeId', 'id']), 120);
      const assignments = ownData(edge, 'assignments') ?? ownData(edge, 'panelAssignments');
      if (!edgeId || edgeIds.has(edgeId) || !Array.isArray(assignments) ||
          !assignments.length || assignments.length > MAX_ASSIGNMENTS_PER_EDGE) {
        malformed = true;
        continue;
      }
      assignmentCount += assignments.length;
      if (assignmentCount > MAX_ASSIGNMENTS) {
        return emptyAudit(ledger, { malformed: true, limitExceeded: true });
      }
      edgeIds.add(edgeId);
      const seen = new Set();
      for (let at = 0; at < assignments.length; at += 1) {
        const assignment = ownData(assignments, String(at));
        const key = clean(ownData(assignment, 'panelKey'), 100);
        const hasEvidenceClass = hasOwn(assignment, 'evidenceClass');
        const evidenceClass = hasEvidenceClass
          ? clean(ownData(assignment, 'evidenceClass'), 24).toLowerCase() : 'other';
        const extra = ownKeys(assignment).filter(name => !['panelKey', 'evidenceClass'].includes(name));
        const signature = `${key}\u0000${evidenceClass}`;
        if (!key || !['sufficiency', 'necessity', 'other'].includes(evidenceClass) ||
            extra.length || seen.has(signature)) {
          malformed = true;
          if (allowed.has(key)) invalidPanels.add(key);
          continue;
        }
        seen.add(signature);
        if (!allowed.has(key)) {
          unknownPanels.add(key);
          malformed = true;
          continue;
        }
        if (!assignedByPanel.has(key)) assignedByPanel.set(key, new Set());
        assignedByPanel.get(key).add(edgeId);
      }
    }

    for (let index = 0; index < dispositions.length; index += 1) {
      const disposition = ownData(dispositions, String(index));
      const key = clean(ownData(disposition, 'panelKey'), 100);
      const extra = ownKeys(disposition).filter(name => ![
        'panelKey', 'status', 'edgeIds', 'reason', 'statusReason', 'candidatePanelKeys'
      ].includes(name));
      if (!key || extra.length) malformed = true;
      if (!allowed.has(key)) {
        if (key) unknownPanels.add(key);
        malformed = true;
        continue;
      }
      counts.set(key, (counts.get(key) || 0) + 1);
      dispositionByPanel.set(key, disposition);
      const status = clean(ownData(disposition, 'status'), 24).toLowerCase();
      const hasReason = hasOwn(disposition, 'reason');
      const hasStatusReason = hasOwn(disposition, 'statusReason');
      const rawReason = firstOwnData(disposition, ['reason', 'statusReason']);
      const reason = clean(rawReason, 600);
      const hasEdgeIds = hasOwn(disposition, 'edgeIds');
      const hasCandidates = hasOwn(disposition, 'candidatePanelKeys');
      const rawEdgeIds = ownData(disposition, 'edgeIds');
      const rawCandidates = ownData(disposition, 'candidatePanelKeys');
      let declaredEdges = [];
      let candidates = [];
      if (((hasReason || hasStatusReason) && typeof rawReason !== 'string') ||
          (hasReason && hasStatusReason) ||
          (hasEdgeIds && !Array.isArray(rawEdgeIds)) ||
          (hasCandidates && !Array.isArray(rawCandidates))) {
        invalidPanels.add(key);
        malformed = true;
      }
      try {
        declaredEdges = boundedStringArray(rawEdgeIds, MAX_EDGE_IDS, 120,
          'PANEL_LEDGER_EDGE_ID_LIMIT');
        candidates = boundedStringArray(rawCandidates, MAX_CANDIDATES, 100,
          'PANEL_LEDGER_CANDIDATE_LIMIT').map(normalizeCandidateKey).filter(Boolean);
      } catch (_) {
        invalidPanels.add(key);
        malformed = true;
      }
      if (!['linked', 'unlinked', 'excluded', 'ambiguous'].includes(status)) {
        invalidPanels.add(key);
      } else if (status === 'linked') {
        if (!declaredEdges.length || declaredEdges.length !==
            (Array.isArray(rawEdgeIds) ? rawEdgeIds.length : 0)) invalidPanels.add(key);
        if (hasCandidates || hasReason || hasStatusReason) invalidPanels.add(key);
        for (const edgeId of declaredEdges) if (!edgeIds.has(edgeId)) unknownEdges.add(edgeId);
      } else if (status === 'unlinked' || status === 'excluded') {
        if (hasEdgeIds || hasCandidates || !reason) invalidPanels.add(key);
      } else if (status === 'ambiguous') {
        if (hasEdgeIds) invalidPanels.add(key);
        const rawCandidateLength = Array.isArray(rawCandidates) ? rawCandidates.length : 0;
        if (rawCandidateLength !== candidates.length || new Set(candidates).size !== candidates.length) {
          invalidPanels.add(key);
          malformed = true;
        }
        for (let candidateIndex = 0; candidateIndex < rawCandidateLength; candidateIndex += 1) {
          const candidate = normalizeCandidateKey(ownData(rawCandidates, String(candidateIndex)));
          if (!candidate || candidate === key) invalidPanels.add(key);
          else if (!allowed.has(candidate)) {
            unknownPanels.add(candidate);
            invalidPanels.add(key);
          }
        }
        if (!reason && !candidates.length) invalidPanels.add(key);
      }
    }

    for (const [key, assigned] of assignedByPanel) {
      const disposition = dispositionByPanel.get(key);
      const status = clean(ownData(disposition, 'status'), 24).toLowerCase();
      let declared = [];
      try {
        declared = boundedStringArray(ownData(disposition, 'edgeIds'), MAX_EDGE_IDS, 120,
          'PANEL_LEDGER_EDGE_ID_LIMIT');
      } catch (_) { malformed = true; }
      const declaredSet = new Set(declared);
      if (status !== 'linked' || [...assigned].some(edgeId => !declaredSet.has(edgeId))) {
        invalidPanels.add(key);
      }
    }
    for (const [key, disposition] of dispositionByPanel) {
      if (clean(ownData(disposition, 'status'), 24).toLowerCase() !== 'linked') continue;
      const assigned = assignedByPanel.get(key) || new Set();
      let declared = [];
      try {
        declared = boundedStringArray(ownData(disposition, 'edgeIds'), MAX_EDGE_IDS, 120,
          'PANEL_LEDGER_EDGE_ID_LIMIT');
      } catch (_) { malformed = true; }
      if (!declared.length || declared.some(edgeId => !assigned.has(edgeId))) invalidPanels.add(key);
    }

    const missingPanelKeys = ledger.entries.map(entry => entry.panelKey).filter(key => !counts.has(key));
    const duplicatePanelKeys = ledger.entries.map(entry => entry.panelKey)
      .filter(key => (counts.get(key) || 0) > 1);
    for (const key of duplicatePanelKeys) invalidPanels.add(key);
    if (unknownEdges.size) malformed = true;
    const invalidPanelKeys = ledger.entries.map(entry => entry.panelKey)
      .filter(key => invalidPanels.has(key));
    return Object.freeze({
      ok: ledger.entries.length > 0 && !malformed && !missingPanelKeys.length &&
        !duplicatePanelKeys.length && !unknownPanels.size && !unknownEdges.size &&
        !invalidPanelKeys.length,
      total: ledger.entries.length,
      covered: Math.max(0, ledger.entries.length - missingPanelKeys.length - invalidPanelKeys.length),
      missingPanelKeys: Object.freeze(missingPanelKeys),
      duplicatePanelKeys: Object.freeze(duplicatePanelKeys),
      unknownPanelKeys: Object.freeze([...unknownPanels].sort()),
      unknownEdgeIds: Object.freeze([...unknownEdges].sort()),
      invalidPanelKeys: Object.freeze(invalidPanelKeys),
      malformed,
      limitExceeded: false
    });
  }

  return { PANEL_LEDGER_VERSION, buildPanelLedger, normalizePanelLedger,
    mergePanelLedgerReview, auditPanelCoverage };
});
