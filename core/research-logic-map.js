(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const RESEARCH_LOGIC_MAP_KIND = 'brevess-research-logic-map';
  const RESEARCH_LOGIC_MAP_SCHEMA_VERSION = 3;
  const RESEARCH_LOGIC_MAP_INDEX_PATH = 'logic-maps/index.json';

  function text(value, maximum = 12000) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maximum);
  }

  function list(value, maximum = 60) {
    return (Array.isArray(value) ? value : [])
      .map(item => text(item, 200))
      .filter(Boolean)
      .slice(0, maximum);
  }

  function clone(value) {
    try {
      return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
    } catch (_) {
      return JSON.parse(JSON.stringify(value));
    }
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, stableValue(value[key])]));
  }

  function researchLogicMapFingerprint(value) {
    let source;
    try { source = JSON.stringify(stableValue(value)); } catch (_) { source = String(value); }
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function safeId(value, fallback = 'item') {
    const normalized = text(value, 200)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return normalized || fallback;
  }

  function normalizeEditedFields(value, allowed) {
    const allow = new Set(allowed);
    return [...new Set((Array.isArray(value) ? value : []).map(field => String(field)))]
      .filter(field => allow.has(field));
  }

  function editedState(value, allowed = []) {
    return {
      manuallyEdited: value?.manuallyEdited === true,
      manuallyEditedFields: normalizeEditedFields(value?.manuallyEditedFields, allowed),
      humanReviewed: value?.humanReviewed === true
    };
  }

  function allocateCollectionId(value, prefix, index, used) {
    const requested = safeId(value, '');
    if (requested && !used.has(requested)) {
      used.add(requested);
      return requested;
    }
    const base = safeId(`${prefix}-${index + 1}`, `${prefix}-${index + 1}`);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = safeId(`${base}-${suffix}`, `${prefix}-${index + 1}-${suffix}`);
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  }

  function normalizeTextItems(value, prefix, maximum = 60) {
    const source = Array.isArray(value)
      ? value
      : (text(value) ? [{ text: value }] : []);
    const used = new Set();
    return source.slice(0, maximum).map((item, index) => ({
      itemId: allocateCollectionId(item?.itemId, prefix, index, used),
      text: text(item?.text ?? item, 2400),
      ...editedState(item, ['text'])
    })).filter(item => item.text);
  }

  function normalizeScientificQuestions(value) {
    const source = Array.isArray(value)
      ? value
      : (text(value) ? [{ text: value }] : []);
    const used = new Set();
    return source.slice(0, 60).map((item, index) => ({
      questionId: allocateCollectionId(item?.questionId, 'question', index, used),
      text: text(item?.text ?? item, 2400),
      ...editedState(item, ['text'])
    })).filter(item => item.text);
  }

  function normalizeFinalConclusions(value, validQuestionIds = new Set()) {
    const source = Array.isArray(value)
      ? value
      : (text(value) ? [{ text: value }] : []);
    const used = new Set();
    return source.slice(0, 60).map((item, index) => ({
      conclusionId: allocateCollectionId(
        item?.conclusionId, 'conclusion', index, used
      ),
      text: text(item?.text ?? item, 3000),
      questionIds: [...new Set((Array.isArray(item?.questionIds)
        ? item.questionIds : []).map(questionId => safeId(questionId, '')))]
        .filter(questionId => validQuestionIds.has(questionId)),
      ...editedState(item, ['text', 'questionIds'])
    })).filter(item => item.text);
  }

  function normalizeDocumentHash(value) {
    const raw = text(value, 80).toLowerCase();
    if (!raw) return '';
    const hex = raw.replace(/^sha256:/, '');
    return /^[a-f0-9]{64}$/.test(hex) ? `sha256:${hex}` : '';
  }

  function researchLogicMapAssetPath(mapId) {
    return `logic-maps/${safeId(mapId, 'logic-map')}.json`;
  }

  function mapFigureResult(figure) {
    if (!figure || typeof figure !== 'object') return null;
    if (figure.activeDepth === 'standard') {
      return figure.standard || figure.deep || null;
    }
    return figure.deep || figure.standard || null;
  }

  function firstSentence(value, maximum = 260) {
    const source = text(value, Math.max(maximum * 4, 1200));
    if (!source) return '';
    const sentence = source.match(/^.*?[。！？.!?](?:\s|$)/u)?.[0]?.trim() || source;
    return sentence.length > maximum
      ? `${sentence.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`
      : sentence;
  }

  function deriveMechanismEdgesFromSteps(steps = []) {
    const mechanismPattern =
      /通路|信号|机制|相互作用|调控|介导|释放|转运体|受体|磷酸化|激活|抑制|上调|下调|必要/u;
    const entityPattern = /[A-Za-z][A-Za-z0-9+./-]{1,}|[\u4e00-\u9fff]+(?:酸|酶|受体|细胞|神经元)/gu;
    const candidates = steps.map((step, index) => ({
      step,
      index,
      value: text(
        (Array.isArray(step?.proofItems) ? step.proofItems : [])
          .map(item => item?.text).filter(Boolean).join('；') || step?.established,
        2400
      )
    }))
      .filter(item => item.value && mechanismPattern.test(item.value))
      .map(item => {
        const { value } = item;
        const entities = value.match(entityPattern) || [];
        const score =
          (value.includes('通路') ? 8 : 0) +
          (value.includes('相互作用') ? 6 : 0) +
          (value.includes('介导') || value.includes('调控') ? 4 : 0) +
          Math.min(8, new Set(entities.map(item => item.toLowerCase())).size);
        return { ...item, score };
      })
      .sort((left, right) => right.score - left.score);
    const best = candidates[0] || null;
    if (!best) return [];
    const clauses = best.value.split(/[，,；;。]/u)
      .map(value => value.trim()
        .replace(/^(并且|并|且|从而|进而|继而|而|同时)/u, '')
        .replace(/^该轴的?/u, '该通路'))
      .filter(Boolean)
      .slice(0, 4);
    if (clauses.length < 2) return [];
    const figureNumber = Number(
      text(best.step?.figureLabel, 80).match(/\d+/u)?.[0] || best.index + 1
    );
    const groups = Array.isArray(best.step?.evidenceGroups)
      ? best.step.evidenceGroups : [];
    return clauses.slice(0, -1).map((from, index) => {
      const group = groups[Math.min(index, Math.max(0, groups.length - 1))] || {};
      const supportPanels = (Array.isArray(group.evidencePoints)
        ? group.evidencePoints.flatMap(point => point?.locator?.kind === 'panels'
          ? point.locator.values : [])
        : (Array.isArray(group.panels) ? group.panels : []))
        .map(panel => text(panel, 20)
          .replace(/^panel\s*/iu, '').replace(/\s+/g, '').toUpperCase())
        .filter(Boolean)
        .map(panel => `${figureNumber}${panel}`)
        .slice(0, 12);
      return {
        sourceId: text(from, 240),
        targetId: text(clauses[index + 1], 240),
        effect: 'associate',
        evidence: 'weak',
        supportPanels
      };
    });
  }

  function deriveMechanismChainFromSteps(steps = []) {
    const edges = deriveMechanismEdgesFromSteps(steps);
    const chain = edges.length
      ? [edges[0].sourceId, ...edges.map(edge => edge.targetId)].join(' → ')
      : '';
    return chain.length > 360 ? `${chain.slice(0, 359).trimEnd()}…` : chain;
  }

  function compressPanelReferences(values) {
    const refs = [...new Set((Array.isArray(values) ? values : [])
      .map(value => text(value, 30).toUpperCase()).filter(Boolean))];
    const groups = new Map();
    refs.forEach(reference => {
      const match = reference.match(/^(\d+)([A-Z])$/u);
      const key = match?.[1] || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(match?.[2] || reference);
    });
    const compact = [];
    groups.forEach((panels, figure) => {
      if (figure === 'other') {
        compact.push(...panels);
        return;
      }
      const sorted = [...new Set(panels)].sort();
      let start = sorted[0];
      let previous = sorted[0];
      const flush = () => {
        if (!start) return;
        compact.push(start === previous
          ? `${figure}${start}` : `${figure}${start}–${figure}${previous}`);
      };
      sorted.slice(1).forEach(panel => {
        if (panel.charCodeAt(0) === previous.charCodeAt(0) + 1) {
          previous = panel;
          return;
        }
        flush();
        start = panel;
        previous = panel;
      });
      flush();
    });
    return compact.join(' · ');
  }

  function crossFigureNodeMap(crossFigureLogic) {
    return new Map((Array.isArray(crossFigureLogic?.nodes) ? crossFigureLogic.nodes : [])
      .map(node => [text(node?.figureId, 120), node])
      .filter(([figureId]) => figureId));
  }

  function crossFigureLinkMap(crossFigureLogic) {
    return new Map((Array.isArray(crossFigureLogic?.dominoChain)
      ? crossFigureLogic.dominoChain : [])
      .map(link => [text(link?.fromFigureId, 120), link])
      .filter(([figureId]) => figureId));
  }

  function mapPanelById(result) {
    return new Map((Array.isArray(result?.panels) ? result.panels : [])
      .map(panel => [text(panel?.panelId || panel?.panel, 80), panel])
      .filter(([panelId]) => panelId));
  }

  function evidenceGroupsFromResult(result, figureId) {
    const panelsById = mapPanelById(result);
    const groups = Array.isArray(result?.panelGroups) ? result.panelGroups : [];
    if (groups.length) {
      return groups.slice(0, 24).map((group, index) => {
        const panelIds = list(group?.panels, 30);
        const panelRecords = panelIds.map(panelId => panelsById.get(panelId)).filter(Boolean);
        const explicitPoints = panelIds.map(panelId => {
          const panel = panelsById.get(panelId);
          const observation = text(
            panel?.directObservation || panel?.localInference || panel?.contribution,
            1600
          );
          if (!observation) return null;
          return {
            locator: { kind: 'panels', values: [panelId] },
            observation,
            argumentRole: text(panel?.role || group?.role, 120),
            limitation: text(panel?.limitation, 1200),
            sourceRefs: [{ kind: 'panel', figureId: text(figureId, 120), panelId }]
          };
        }).filter(Boolean);
        const evidencePoints = explicitPoints.length === panelIds.length && panelIds.length
          ? explicitPoints
          : [{
              locator: { kind: 'panels', values: panelIds },
              observation: text(group?.groupConclusion, 1600),
              argumentRole: text(group?.role, 120),
              limitation: text(group?.limitation, 1200),
              sourceRefs: panelIds.map(panelId => ({
                kind: 'panel', figureId: text(figureId, 120), panelId
              })),
              needsManualSplit: panelIds.length > 1
            }];
        return {
          groupId: `${safeId(figureId, 'figure')}-evidence-${index + 1}`,
          title: text(group?.groupGoal || `证据组 ${index + 1}`, 320),
          method: text(panelRecords.map(panel => panel?.methodCategory)
            .filter(Boolean).join('、'), 320),
          groupConclusion: text(group?.groupConclusion ||
            panelRecords.map(panel => panel?.localInference || panel?.directObservation)
              .filter(Boolean).join('；'), 1600),
          limitation: text(group?.limitation, 1200),
          evidencePoints
        };
      });
    }
    const chain = Array.isArray(result?.argumentChain) ? result.argumentChain : [];
    if (chain.length) {
      return chain.slice(0, 24).map((step, index) => {
        const panelIds = list(step?.panels, 30);
        const panelRecords = panelIds.map(panelId => panelsById.get(panelId)).filter(Boolean);
        const hasIndividualObservations = panelIds.length > 0 && panelRecords.length === panelIds.length &&
          panelRecords.every(panel => text(
            panel?.directObservation || panel?.localInference || panel?.contribution,
            1600
          ));
        const evidencePoints = hasIndividualObservations
          ? panelIds.map(panelId => {
              const panel = panelsById.get(panelId);
              return {
                locator: { kind: 'panels', values: [panelId] },
                observation: text(
                  panel?.directObservation || panel?.localInference || panel?.contribution,
                  1600
                ),
                argumentRole: text(panel?.role || step?.evidenceLevel, 120),
                limitation: text(panel?.limitation, 1200),
                sourceRefs: [{ kind: 'panel', figureId: text(figureId, 120), panelId }]
              };
            })
          : [{
              locator: { kind: 'panels', values: panelIds },
              observation: text(step?.established, 1600),
              argumentRole: text(step?.evidenceLevel, 120),
              limitation: text(step?.limitation, 1200),
              sourceRefs: panelIds.map(panelId => ({
                kind: 'panel', figureId: text(figureId, 120), panelId
              })),
              needsManualSplit: panelIds.length > 1
            }];
        return {
          groupId: `${safeId(figureId, 'figure')}-evidence-${index + 1}`,
          title: text(`证据步骤 ${index + 1}`, 320),
          method: text(panelRecords.map(panel => panel?.methodCategory)
            .filter(Boolean).join('、'), 320),
          groupConclusion: text(step?.established, 1600),
          limitation: text(step?.limitation, 1200),
          evidencePoints
        };
      });
    }
    return (Array.isArray(result?.panels) ? result.panels : []).slice(0, 30)
      .map((panel, index) => {
        const panelId = text(panel?.panelId || panel?.panel || `Panel ${index + 1}`, 80);
        return {
          groupId: `${safeId(figureId, 'figure')}-evidence-${index + 1}`,
          title: text(panel?.purpose || panelId, 320),
          method: text(panel?.methodCategory, 320),
          groupConclusion: text(panel?.localInference || panel?.directObservation ||
            panel?.contribution, 1600),
          limitation: text(panel?.limitation, 1200),
          evidencePoints: [{
            locator: { kind: 'panels', values: panelId ? [panelId] : [] },
            observation: text(panel?.directObservation || panel?.localInference ||
              panel?.contribution, 1600),
            argumentRole: text(panel?.role, 120),
            limitation: text(panel?.limitation, 1200),
            sourceRefs: panelId ? [{
              kind: 'panel', figureId: text(figureId, 120), panelId
            }] : []
          }]
        };
      });
  }

  function supplementalByMainFigure(crossFigureLogic) {
    const grouped = new Map();
    (Array.isArray(crossFigureLogic?.supplementalSupport)
      ? crossFigureLogic.supplementalSupport : []).forEach(item => {
      const mainFigureId = text(
        item?.mainFigureId || item?.supportsFigureId || item?.targetFigureId, 120
      );
      if (!mainFigureId) return;
      const entries = grouped.get(mainFigureId) || [];
      entries.push({
        figureId: text(item?.figureId || item?.supplementalFigureId, 120),
        figureLabel: text(item?.figureLabel || item?.supplementalFigureLabel, 160),
        relationship: text(item?.relationship || item?.supportType || item?.role ||
          item?.supportRole, 320),
        supportRole: text(item?.supportRole || item?.support_role, 80),
        attachmentBasis: text(item?.attachmentBasis || item?.attachment_basis, 80),
        conclusion: text(item?.established || item?.contribution || item?.conclusion, 1200),
        limitation: text(item?.limitation || item?.limitation_zh, 1200)
      });
      grouped.set(mainFigureId, entries);
    });
    return grouped;
  }

  function supplementalPanelPrefix(figure = {}) {
    const label = text(figure?.figureLabel || figure?.figureId, 160);
    const supplemental = label.match(/\bs\s*(\d+)\b/i);
    if (supplemental) return `S${Number(supplemental[1])}`;
    const supplementary = label.match(/supplement(?:al|ary)\s+fig(?:ure)?\s*(\d+)/i);
    if (supplementary) return `S${Number(supplementary[1])}`;
    const extended = label.match(/extended\s+data\s+(?:fig(?:ure)?\s*)?(\d+)/i);
    return extended ? `ED${Number(extended[1])}` : label.replace(/\s+/g, '');
  }

  function supplementalEvidenceGroups(figure, result, attachment = {}) {
    const prefix = supplementalPanelPrefix(figure);
    return evidenceGroupsFromResult(result, figure.figureId).map((group, index) => ({
      ...group,
      groupId: `${safeId(figure.figureId, 'supplement')}-supplement-${index + 1}`,
      title: text(`${figure.figureLabel || '补充图'} · ${group.title}`, 320),
      evidencePoints: group.evidencePoints.map(point => ({
        ...point,
        locator: point.locator?.kind === 'panels'
          ? {
              kind: 'panels',
              values: point.locator.values.map(panel => {
                const value = text(panel, 40).replace(/^panel\s*/i, '');
                return prefix && value ? `${prefix}${value}` : value;
              })
            }
          : point.locator,
        argumentRole: text(point.argumentRole || '补充证据', 120)
      })),
      // Parsed supplemental results may carry an entire Figure legend here.
      // Preserve that source text in the Figure workspace, while the map uses
      // the concise contribution produced by cross-Figure synthesis.
      groupConclusion: text(attachment.conclusion || group.groupConclusion, 1600),
      isSupplemental: true,
      sourceFigureLabel: text(figure.figureLabel || figure.figureId, 160),
      supportRole: text(attachment.supportRole || attachment.relationship, 80),
      attachmentBasis: text(attachment.attachmentBasis, 80),
      limitation: text(attachment.limitation, 1200)
    }));
  }

  function normalizeEvidenceLocator(value = {}) {
    const kind = text(value?.kind, 40).toLowerCase();
    if (kind === 'time-range') {
      const rawStart = Number(value?.startSeconds);
      const rawEnd = Number(value?.endSeconds);
      const startSeconds = Number.isFinite(rawStart) ? Math.max(0, rawStart) : 0;
      const boundedEnd = Number.isFinite(rawEnd) ? Math.max(0, rawEnd) : startSeconds;
      return {
        kind: 'time-range',
        startSeconds,
        endSeconds: Math.max(startSeconds, boundedEnd)
      };
    }
    if (kind === 'table-range') {
      return { kind: 'table-range', value: text(value?.value, 160) };
    }
    const values = [...new Set((Array.isArray(value?.values)
      ? value.values : []).map(item => text(item, 40)
      .replace(/^panel\s*/i, '').trim()).filter(Boolean))].slice(0, 30);
    return { kind: 'panels', values };
  }

  function normalizeSourceRefs(value) {
    return (Array.isArray(value) ? value : []).slice(0, 30).map(source => {
      const kind = ['panel', 'figure', 'video', 'table'].includes(source?.kind)
        ? source.kind : (source?.panelId ? 'panel' : 'figure');
      const normalized = {
        kind,
        figureId: text(source?.figureId, 120)
      };
      if (kind === 'panel') normalized.panelId = text(source?.panelId, 80);
      if (kind === 'video') {
        normalized.startSeconds = Math.max(0, Number(source?.startSeconds) || 0);
        normalized.endSeconds = Math.max(
          normalized.startSeconds,
          Math.max(0, Number(source?.endSeconds) || normalized.startSeconds)
        );
      }
      if (kind === 'table') normalized.range = text(source?.range, 160);
      return normalized;
    }).filter(source => source.figureId || source.panelId || source.range ||
      source.kind === 'video');
  }

  function normalizeEvidencePoint(value, groupId, index, pointIdAllocator = null) {
    const locator = value?.locator && typeof value.locator === 'object'
      ? value.locator
      : { kind: 'panels', values: value?.panels || [] };
    const pointId = pointIdAllocator
      ? pointIdAllocator(value?.pointId, index)
      : safeId(value?.pointId, `${groupId}-point-${index + 1}`);
    return {
      pointId,
      locator: normalizeEvidenceLocator(locator),
      observation: text(value?.observation || value?.conclusion, 1600),
      argumentRole: text(value?.argumentRole || value?.category, 120),
      limitation: text(value?.limitation, 1200),
      sourceRefs: normalizeSourceRefs(value?.sourceRefs),
      needsManualSplit: value?.needsManualSplit === true,
      ...editedState(value, [
        'locator', 'observation', 'argumentRole', 'limitation', 'sourceRefs'
      ])
    };
  }

  function normalizeEvidenceGroupV3(group, stepId, index, groupIdAllocator = null) {
    const groupId = groupIdAllocator
      ? groupIdAllocator(group?.groupId, index)
      : safeId(group?.groupId, `${stepId}-evidence-${index + 1}`);
    const explicit = Array.isArray(group?.evidencePoints) ? group.evidencePoints : null;
    const legacyPanels = list(group?.panels, 30)
      .map(value => text(value, 40).replace(/^panel\s*/i, '').trim())
      .filter(Boolean);
    const legacyObservations = (Array.isArray(group?.observations)
      ? group.observations : []).map(value => text(value, 1600)).filter(Boolean);
    const legacyRoles = (Array.isArray(group?.argumentRoles)
      ? group.argumentRoles : []).map(value => text(value, 120)).filter(Boolean);
    const legacyPoint = {
      locator: { kind: 'panels', values: legacyPanels },
      observation: text(group?.conclusion, 1600) || legacyObservations.join('；'),
      argumentRole: text(group?.category, 120) || legacyRoles.join('；'),
      limitation: group?.limitation,
      sourceRefs: group?.sourceRefs,
      needsManualSplit: legacyPanels.length > 1 || legacyObservations.length > 1 ||
        legacyRoles.length > 1
    };
    const pointIds = new Set();
    const allocatePointId = (value, pointIndex) => allocateCollectionId(
      value, `${groupId}-point`, pointIndex, pointIds
    );
    const evidencePoints = (explicit || [legacyPoint]).slice(0, 60)
      .map((point, pointIndex) => normalizeEvidencePoint(
        point, groupId, pointIndex, allocatePointId
      ))
      .filter(point => point.observation || point.argumentRole ||
        point.locator.kind !== 'panels' || point.locator.values.length);
    return {
      groupId,
      title: text(group?.title || `证据组 ${index + 1}`, 320),
      method: text(group?.method, 320),
      groupConclusion: text(group?.groupConclusion || group?.conclusion, 1600),
      limitation: text(group?.limitation, 1200),
      evidencePoints,
      ...editedState(group, [
        'title', 'method', 'groupConclusion', 'limitation', 'evidencePoints'
      ])
    };
  }

  function normalizeMechanismEffect(value) {
    const normalized = text(value, 80).toLowerCase();
    if (/inhibit|inhibits|inhibition|suppress|negative|抑制|下调/u.test(normalized)) {
      return 'inhibit';
    }
    if (/promote|promotes|promotion|activate|positive|促进|激活|上调/u.test(normalized)) {
      return 'promote';
    }
    return 'associate';
  }

  function normalizeMechanismEdges(value, steps = []) {
    const source = Array.isArray(value) ? value : deriveMechanismEdgesFromSteps(steps);
    return source.slice(0, 32).map(edge => ({
      sourceId: text(edge?.sourceId || edge?.from, 240),
      targetId: text(edge?.targetId || edge?.to, 240),
      effect: normalizeMechanismEffect(edge?.effect || edge?.relation),
      evidence: text(edge?.evidence || edge?.strength, 40).toLowerCase() === 'strong'
        ? 'strong' : 'weak',
      supportPanels: list(edge?.supportPanels, 24),
      ...editedState(edge, [
        'sourceId', 'targetId', 'effect', 'evidence', 'supportPanels'
      ])
    })).filter(edge => edge.sourceId && edge.targetId);
  }

  function normalizeSupplementalConnections(value, material, steps) {
    const source = Array.isArray(value) ? value : [];
    const stepById = new Map(steps.map(step => [step.stepId, step]));
    const sourceGroupIds = new Set(
      material.evidenceGroups.map(group => group.groupId)
    );
    const used = new Set();
    return source.slice(0, 120).map((connection, index) => {
      const requestedMode = text(connection?.mode, 40);
      if (requestedMode && !['figure', 'evidence-group'].includes(requestedMode)) {
        return null;
      }
      const mode = requestedMode || 'figure';
      const targetStepId = safeId(connection?.targetStepId, '');
      const sourceGroupId = mode === 'evidence-group'
        ? safeId(connection?.sourceGroupId, '') : '';
      const targetGroupId = mode === 'evidence-group'
        ? safeId(connection?.targetGroupId, '') : '';
      const targetStep = stepById.get(targetStepId);
      const targetGroupIds = new Set(
        (targetStep?.evidenceGroups || []).map(group => group.groupId)
      );
      const valid = Boolean(targetStep) && (mode === 'figure' || (
        sourceGroupIds.has(sourceGroupId) && targetGroupIds.has(targetGroupId)
      ));
      if (!valid) return null;
      return {
        connectionId: allocateCollectionId(
          connection?.connectionId,
          `${material.supplementalId}-connection`,
          index,
          used
        ),
        mode,
        targetStepId,
        sourceGroupId,
        targetGroupId,
        ...editedState(connection, [
          'mode', 'targetStepId', 'sourceGroupId', 'targetGroupId'
        ])
      };
    }).filter(Boolean);
  }

  function normalizeSupplementalPlaceholders(value, steps = []) {
    const source = Array.isArray(value) ? value : [];
    const used = new Set();
    return source.slice(0, 120).map((item, index) => {
      const supplementalId = allocateCollectionId(
        item?.supplementalId, 'supplemental', index, used
      );
      const groupIds = new Set();
      const allocateGroupId = (value, groupIndex) => allocateCollectionId(
        value, `${supplementalId}-evidence`, groupIndex, groupIds
      );
      const material = {
        supplementalId,
        type: ['figure', 'video', 'table'].includes(item?.type) ? item.type : 'figure',
        label: text(item?.label || item?.figureLabel, 240),
        proofItems: normalizeTextItems(
          Array.isArray(item?.proofItems) ? item.proofItems : item?.conclusion,
          `${supplementalId}-proof`
        ),
        evidenceGroups: (Array.isArray(item?.evidenceGroups)
          ? item.evidenceGroups : []).slice(0, 30)
          .map((group, groupIndex) => normalizeEvidenceGroupV3(
            group, supplementalId, groupIndex, allocateGroupId
          )),
        connections: [],
        ...editedState(item, [
          'type', 'label', 'proofItems', 'evidenceGroups', 'connections'
        ])
      };
      material.connections = normalizeSupplementalConnections(
        item?.connections, material, steps
      );
      return material;
    }).filter(item => item.label);
  }

  function normalizeResearchLogicMap(input = {}) {
    const timestamp = text(input?.meta?.updatedAt || input?.updatedAt ||
      new Date().toISOString(), 80);
    const mapId = safeId(input?.mapId, `logic-map-${Date.now()}`);
    const sourceSteps = (Array.isArray(input?.steps) ? input.steps : []).slice(0, 120);
    const stepIdSet = new Set();
    const steps = sourceSteps.map((step, index) => {
      const stepId = allocateCollectionId(step?.stepId, 'step', index, stepIdSet);
      const groupIds = new Set();
      const allocateGroupId = (value, groupIndex) => allocateCollectionId(
        value, `${stepId}-evidence`, groupIndex, groupIds
      );
      const questionSource = Array.isArray(step?.questionItems)
        ? step.questionItems : step?.question;
      const proofSource = Array.isArray(step?.proofItems)
        ? step.proofItems : step?.established;
      return {
        stepId,
        order: index + 1,
        figureId: text(step?.figureId, 120),
        figureLabel: text(step?.figureLabel || `Figure ${index + 1}`, 160),
        questionItems: normalizeTextItems(
          questionSource, `${stepId}-question`
        ),
        proofItems: normalizeTextItems(proofSource, `${stepId}-proof`),
        role: text(step?.role, 160),
        evidenceLevel: text(step?.evidenceLevel, 160),
        evidenceGroups: (Array.isArray(step?.evidenceGroups)
          ? step.evidenceGroups : []).slice(0, 30)
          .map((group, groupIndex) => normalizeEvidenceGroupV3(
            group, stepId, groupIndex, allocateGroupId
          )),
        notes: text(step?.notes, 4000),
        ...editedState(step, [
          'figureId', 'figureLabel', 'questionItems', 'proofItems', 'role',
          'evidenceLevel', 'evidenceGroups', 'notes'
        ])
      };
    });
    for (let index = 1; index < steps.length; index += 1) {
      if (!steps[index].questionItems.length) {
        steps[index].questionItems = normalizeTextItems(
          sourceSteps[index - 1]?.nextQuestion,
          `${steps[index].stepId}-question`
        );
      }
    }
    const stepIds = new Set(steps.map(step => step.stepId));
    const links = (Array.isArray(input?.links) ? input.links : []).slice(0, 160)
      .map(link => ({
        fromStepId: safeId(link?.fromStepId, ''),
        toStepId: safeId(link?.toStepId, ''),
        label: text(link?.label || '因此下一图需要回答', 320),
        boundary: text(link?.boundary, 1200)
      }))
      .filter(link => stepIds.has(link.fromStepId) && stepIds.has(link.toStepId));
    const metaInput = input?.meta && typeof input.meta === 'object' ? input.meta : {};
    const legacy = Number(input?.schemaVersion || 2) < 3;
    const backgroundSource = Array.isArray(metaInput.backgroundItems)
      ? metaInput.backgroundItems
      : (legacy ? metaInput.background || metaInput.overallThesis : []);
    const backgroundItems = normalizeTextItems(backgroundSource, 'background');
    const scientificQuestions = normalizeScientificQuestions(
      Array.isArray(metaInput.scientificQuestions)
        ? metaInput.scientificQuestions : metaInput.scientificQuestion
    );
    const scientificQuestionIds = new Set(
      scientificQuestions.map(item => item.questionId)
    );
    const finalConclusions = normalizeFinalConclusions(
      Array.isArray(metaInput.finalConclusions)
        ? metaInput.finalConclusions : metaInput.finalConclusion,
      scientificQuestionIds
    );
    const mechanismEdges = normalizeMechanismEdges(
      metaInput.mechanismEdges, steps
    );
    const mechanismChainFromEdges = mechanismEdges.length
      ? [mechanismEdges[0].sourceId,
          ...mechanismEdges.map(edge => edge.targetId)].join(' → ')
      : '';
    const supplementalMaterials = normalizeSupplementalPlaceholders(
      input?.supplementalMaterials, steps
    );
    const supplementalIds = new Set(
      supplementalMaterials.map(item => item.supplementalId)
    );
    const collapsedStepIds = [...new Set((Array.isArray(input?.view?.collapsedStepIds)
      ? input.view.collapsedStepIds : []).map(value => safeId(value, '')))]
      .filter(value => stepIds.has(value));
    const collapsedSupplementalIds = [...new Set((Array.isArray(
      input?.view?.collapsedSupplementalIds
    ) ? input.view.collapsedSupplementalIds : []).map(value => safeId(value, '')))]
      .filter(value => supplementalIds.has(value));
    return {
      schemaVersion: RESEARCH_LOGIC_MAP_SCHEMA_VERSION,
      kind: RESEARCH_LOGIC_MAP_KIND,
      mapId,
      origin: input?.origin === 'manual' ? 'manual' : 'figure-analysis',
      workspaceId: text(input?.workspaceId, 200),
      sourceHash: text(input?.sourceHash, 80),
      generatedAt: text(input?.generatedAt || timestamp, 80),
      userEditedAt: text(input?.userEditedAt, 80),
      meta: {
        title: text(metaInput.title || '论文论证阶梯', 240),
        articleTitle: text(metaInput.articleTitle, 500),
        canonicalUrl: text(metaInput.canonicalUrl, 2000),
        documentHash: normalizeDocumentHash(metaInput.documentHash),
        backgroundItems,
        scientificQuestions,
        finalConclusions,
        overallThesis: text(metaInput.overallThesis, 3000),
        mechanismEdges,
        mechanismChain: text(metaInput.mechanismChain, 1200) ||
          mechanismChainFromEdges || deriveMechanismChainFromSteps(steps),
        claimBoundary: text(metaInput.claimBoundary, 3000),
        supplementalCoverage: metaInput.supplementalCoverage &&
          typeof metaInput.supplementalCoverage === 'object'
          ? {
              status: text(metaInput.supplementalCoverage.status, 40),
              expectedFigureCount: Math.max(0,
                Number(metaInput.supplementalCoverage.expectedFigureCount) || 0),
              foundFigureCount: Math.max(0,
                Number(metaInput.supplementalCoverage.foundFigureCount) || 0),
              analyzedFigureCount: Math.max(0,
                Number(metaInput.supplementalCoverage.analyzedFigureCount) || 0),
              missingFigureLabels: list(
                metaInput.supplementalCoverage.missingFigureLabels, 80
              )
            }
          : null,
        updatedAt: timestamp,
        ...editedState(metaInput, [
          'title', 'articleTitle', 'canonicalUrl', 'documentHash',
          'backgroundItems', 'scientificQuestions', 'finalConclusions',
          'mechanismEdges', 'claimBoundary'
        ])
      },
      steps,
      links,
      supplementalMaterials,
      view: {
        zoom: Math.max(0.6, Math.min(1.6, Number(input?.view?.zoom) || 1)),
        editorCollapsed: input?.view?.editorCollapsed === true,
        collapsedStepIds,
        collapsedSupplementalIds
      },
      ...editedState(input, [
        'meta', 'steps', 'links', 'supplementalMaterials', 'view'
      ])
    };
  }

  function createResearchLogicMapFromFigures(input = {}) {
    const figureWorkspace = input.figureWorkspace || {};
    const crossFigureLogic = input.crossFigureLogic ||
      figureWorkspace?.crossFigureLogic?.result || null;
    const nodes = crossFigureNodeMap(crossFigureLogic);
    const linksBySource = crossFigureLinkMap(crossFigureLogic);
    const supplemental = supplementalByMainFigure(crossFigureLogic);
    const allFigures = Array.isArray(figureWorkspace?.figures)
      ? figureWorkspace.figures : [];
    const figures = allFigures
      .filter(figure => figure?.isSupplemental !== true && mapFigureResult(figure));
    const supplementalFigures = allFigures
      .filter(figure => figure?.isSupplemental === true && mapFigureResult(figure));
    if (!figures.length) {
      const error = new Error('RESEARCH_LOGIC_MAP_REQUIRES_FIGURE_ANALYSIS');
      error.code = 'RESEARCH_LOGIC_MAP_REQUIRES_FIGURE_ANALYSIS';
      throw error;
    }
    const source = {
      figures: figures.map(figure => ({
        figureId: figure.figureId,
        figureInputHash: figure.figureInputHash,
        activeDepth: figure.activeDepth,
        result: mapFigureResult(figure)
      })),
      supplementalFigures: supplementalFigures.map(figure => ({
        figureId: figure.figureId,
        figureInputHash: figure.figureInputHash,
        activeDepth: figure.activeDepth,
        result: mapFigureResult(figure)
      })),
      crossFigureLogic
    };
    const sourceHash = researchLogicMapFingerprint(source);
    const timestamp = text(input.now || new Date().toISOString(), 80);
    const steps = figures.map((figure, index) => {
      const result = mapFigureResult(figure);
      const node = nodes.get(text(figure.figureId, 120)) || {};
      const previousFigureId = index > 0
        ? text(figures[index - 1]?.figureId, 120) : '';
      const precedingHandoff = previousFigureId
        ? text(linksBySource.get(previousFigureId)?.transition, 1800) : '';
      const question = text(precedingHandoff || result?.figureQuestion || node?.question ||
        '这张图要回答什么问题？', 1800);
      const proof = text(node?.established || result?.coreConclusion, 2400);
      return {
        stepId: `figure-step-${index + 1}-${safeId(figure.figureId, 'figure')}`,
        figureId: text(figure.figureId, 120),
        figureLabel: text(figure.figureLabel || `Figure ${index + 1}`, 160),
        questionItems: question ? [{
          itemId: `figure-step-${index + 1}-question-1`, text: question
        }] : [],
        proofItems: proof ? [{
          itemId: `figure-step-${index + 1}-proof-1`, text: proof
        }] : [],
        role: text(node?.role || result?.paperArgumentRole, 160),
        evidenceLevel: text(node?.evidenceLevel ||
          (Array.isArray(result?.argumentChain)
            ? result.argumentChain.at(-1)?.evidenceLevel : ''), 160),
        evidenceGroups: evidenceGroupsFromResult(result, figure.figureId).slice(0, 30),
        notes: ''
      };
    });
    const mapLinks = steps.slice(0, -1).map((step, index) => {
      const next = steps[index + 1];
      const crossLink = linksBySource.get(step.figureId) || {};
      return {
        fromStepId: step.stepId,
        toStepId: next.stepId,
        label: '因此下一图需要回答',
        boundary: text(crossLink?.evidenceBoundary, 1200)
      };
    });
    const overallThesis = text(
      crossFigureLogic?.overallThesis ||
        steps.flatMap(step => step.proofItems).map(item => item.text)
          .filter(Boolean).join(' → '),
      3000
    );
    const scientificQuestionText = text(
      input.scientificQuestion || steps[0]?.questionItems?.[0]?.text,
      2400
    );
    const supplementalFigureById = new Map(
      supplementalFigures.map(figure => [text(figure.figureId, 120), figure])
    );
    const supplementalMaterials = [...supplemental.entries()]
      .flatMap(([mainFigureId, items]) => items.map(item => {
        const targetStep = steps.find(step => step.figureId === mainFigureId);
        const figure = supplementalFigureById.get(item.figureId);
        const result = mapFigureResult(figure);
        const evidenceGroups = figure && result
          ? supplementalEvidenceGroups(figure, result, item) : [];
        const proof = text(item.conclusion || result?.coreConclusion, 2400);
        return {
          supplementalId: safeId(item.figureId, 'supplemental'),
          type: 'figure',
          label: text(item.figureLabel || item.figureId, 240),
          proofItems: proof ? [{
            itemId: `${safeId(item.figureId, 'supplemental')}-proof-1`,
            text: proof
          }] : [],
          evidenceGroups,
          connections: targetStep ? [{
            connectionId: `${safeId(item.figureId, 'supplemental')}-figure-link`,
            mode: 'figure',
            targetStepId: targetStep.stepId
          }] : []
        };
      }));
    return normalizeResearchLogicMap({
      schemaVersion: RESEARCH_LOGIC_MAP_SCHEMA_VERSION,
      mapId: input.mapId || `figure-argument-${sourceHash}`,
      origin: 'figure-analysis',
      workspaceId: input.workspaceId,
      sourceHash,
      generatedAt: timestamp,
      meta: {
        title: input.title || '论文论证阶梯',
        articleTitle: input.articleTitle,
        canonicalUrl: input.canonicalUrl,
        documentHash: input.documentHash,
        backgroundItems: input.backgroundItems || [],
        scientificQuestions: scientificQuestionText ? [{
          questionId: 'question-1', text: scientificQuestionText
        }] : [],
        finalConclusions: overallThesis ? [{
          conclusionId: 'conclusion-1',
          text: overallThesis,
          questionIds: scientificQuestionText ? ['question-1'] : []
        }] : [],
        overallThesis,
        mechanismChain: crossFigureLogic?.mechanismChain ||
          deriveMechanismChainFromSteps(steps),
        mechanismEdges: Array.isArray(crossFigureLogic?.mechanismEdges)
          ? crossFigureLogic.mechanismEdges : deriveMechanismEdgesFromSteps(steps),
        claimBoundary: crossFigureLogic?.claimBoundary ||
          figures.map(figure => mapFigureResult(figure)?.claimBoundary)
            .filter(Boolean).join('；'),
        supplementalCoverage: figureWorkspace?.supplemental?.coverage || null,
        updatedAt: timestamp
      },
      steps,
      links: mapLinks,
      supplementalMaterials,
      view: {
        zoom: 1,
        editorCollapsed: false,
        collapsedStepIds: [],
        collapsedSupplementalIds: []
      }
    });
  }

  function createBlankResearchLogicMap(input = {}) {
    const timestamp = text(input.now || new Date().toISOString(), 80);
    const mapId = input.mapId || `manual-argument-${Date.now()}`;
    return normalizeResearchLogicMap({
      schemaVersion: RESEARCH_LOGIC_MAP_SCHEMA_VERSION,
      mapId,
      origin: 'manual',
      workspaceId: input.workspaceId,
      generatedAt: timestamp,
      meta: {
        title: input.title || '未命名论文论证阶梯',
        articleTitle: input.articleTitle,
        canonicalUrl: input.canonicalUrl,
        documentHash: input.documentHash,
        backgroundItems: [],
        scientificQuestions: [],
        finalConclusions: [],
        overallThesis: '',
        mechanismChain: '',
        mechanismEdges: [],
        claimBoundary: '',
        updatedAt: timestamp
      },
      steps: [{
        stepId: 'step-1',
        figureId: '',
        figureLabel: 'Figure 1',
        questionItems: [],
        proofItems: [],
        role: '',
        evidenceLevel: '',
        evidenceGroups: [],
        notes: ''
      }],
      links: [],
      supplementalMaterials: [],
      view: {
        zoom: 1,
        editorCollapsed: false,
        collapsedStepIds: [],
        collapsedSupplementalIds: []
      }
    });
  }

  function mergeEditedFields(current, changed, allowed) {
    return normalizeEditedFields([
      ...(Array.isArray(current) ? current : []),
      ...changed.filter(field => allowed.includes(field))
    ], allowed);
  }

  function updateScientificQuestion(input, questionId, patch = {}) {
    const map = normalizeResearchLogicMap(input);
    const targetId = safeId(questionId, '');
    const index = map.meta.scientificQuestions.findIndex(
      item => item.questionId === targetId
    );
    if (index < 0) return map;
    const next = clone(map);
    const current = next.meta.scientificQuestions[index];
    const changed = [];
    if (Object.hasOwn(patch, 'text')) {
      current.text = text(patch.text, 2400);
      changed.push('text');
    }
    if (Object.hasOwn(patch, 'humanReviewed')) {
      current.humanReviewed = patch.humanReviewed === true;
    }
    current.manuallyEdited = true;
    current.manuallyEditedFields = mergeEditedFields(
      current.manuallyEditedFields, changed, ['text']
    );
    return normalizeResearchLogicMap(next);
  }

  function updateFinalConclusion(input, conclusionId, patch = {}) {
    const map = normalizeResearchLogicMap(input);
    const targetId = safeId(conclusionId, '');
    const index = map.meta.finalConclusions.findIndex(
      item => item.conclusionId === targetId
    );
    if (index < 0) return map;
    const next = clone(map);
    const current = next.meta.finalConclusions[index];
    const changed = [];
    if (Object.hasOwn(patch, 'text')) {
      current.text = text(patch.text, 3000);
      changed.push('text');
    }
    if (Object.hasOwn(patch, 'questionIds')) {
      current.questionIds = Array.isArray(patch.questionIds)
        ? [...patch.questionIds] : [];
      changed.push('questionIds');
    }
    if (Object.hasOwn(patch, 'humanReviewed')) {
      current.humanReviewed = patch.humanReviewed === true;
    }
    current.manuallyEdited = true;
    current.manuallyEditedFields = mergeEditedFields(
      current.manuallyEditedFields, changed, ['text', 'questionIds']
    );
    return normalizeResearchLogicMap(next);
  }

  function normalizeResearchLogicMapIndex(input = {}) {
    const maps = (Array.isArray(input?.maps) ? input.maps : []).slice(0, 200)
      .map(item => ({
        mapId: safeId(item?.mapId, ''),
        title: text(item?.title || '论文论证阶梯', 240),
        origin: item?.origin === 'manual' ? 'manual' : 'figure-analysis',
        relativePath: text(item?.relativePath, 320),
        updatedAt: text(item?.updatedAt, 80),
        sourceHash: text(item?.sourceHash, 80),
        stepCount: Math.max(0, Math.floor(Number(item?.stepCount) || 0))
      }))
      .filter(item => item.mapId && item.relativePath);
    return {
      schemaVersion: 1,
      activeMapId: safeId(input?.activeMapId, ''),
      maps
    };
  }

  function upsertResearchLogicMapIndex(input, map) {
    const index = normalizeResearchLogicMapIndex(input);
    const normalizedMap = normalizeResearchLogicMap(map);
    const entry = {
      mapId: normalizedMap.mapId,
      title: normalizedMap.meta.title,
      origin: normalizedMap.origin,
      relativePath: researchLogicMapAssetPath(normalizedMap.mapId),
      updatedAt: normalizedMap.meta.updatedAt,
      sourceHash: normalizedMap.sourceHash,
      stepCount: normalizedMap.steps.length
    };
    return {
      schemaVersion: 1,
      activeMapId: normalizedMap.mapId,
      maps: [entry, ...index.maps.filter(item => item.mapId !== normalizedMap.mapId)]
        .slice(0, 200)
    };
  }

  function escapeXml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[character]);
  }

  function svgCharacterWidth(character, fontSize) {
    if (/\s/u.test(character)) return fontSize * 0.34;
    if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]/u.test(character)) {
      return fontSize;
    }
    if (/[A-Z0-9]/u.test(character)) return fontSize * 0.66;
    if (/[a-z]/u.test(character)) return fontSize * 0.56;
    return fontSize * 0.48;
  }

  function wrapSvgText(value, maximumWidth = 420, fontSize = 22, maximumLines = 0) {
    const source = text(value, 12000);
    if (!source) return ['—'];
    const lines = [];
    let current = '';
    let currentWidth = 0;
    const tokens = source.match(/[A-Za-z0-9+./_-]+|\s+|./gu) || [];
    for (const token of tokens) {
      const tokenWidth = [...token]
        .reduce((sum, character) => sum + svgCharacterWidth(character, fontSize), 0);
      if (current && currentWidth + tokenWidth > maximumWidth) {
        if (/^[，。；：、！？,.!?;:）)\]】》]$/u.test(token)) {
          current += token;
          currentWidth += tokenWidth;
          continue;
        }
        lines.push(current.trimEnd());
        current = '';
        currentWidth = 0;
        if (maximumLines && lines.length >= maximumLines) break;
      }
      if (tokenWidth <= maximumWidth) {
        if (current || !/^\s+$/u.test(token)) {
          current += token;
          currentWidth += tokenWidth;
        }
        continue;
      }
      for (const character of token) {
        const characterWidth = svgCharacterWidth(character, fontSize);
        if (current && currentWidth + characterWidth > maximumWidth) {
          lines.push(current.trimEnd());
          current = '';
          currentWidth = 0;
          if (maximumLines && lines.length >= maximumLines) break;
        }
        current += character;
        currentWidth += characterWidth;
      }
      if (maximumLines && lines.length >= maximumLines) break;
    }
    if (current && (!maximumLines || lines.length < maximumLines)) {
      lines.push(current.trimEnd());
    }
    if (maximumLines && lines.length === maximumLines) {
      const consumed = lines.join('').length;
      if (consumed < source.length) {
        lines[lines.length - 1] =
          `${lines[lines.length - 1].replace(/[，,；;。\s]+$/u, '')}…`;
      }
    }
    return lines.length ? lines : ['—'];
  }

  function pushSvgLines(parts, {
    value,
    x,
    y,
    width,
    fontSize = 22,
    lineHeight = 31,
    className = 'body',
    maximumLines = 0
  }) {
    const lines = wrapSvgText(value, width, fontSize, maximumLines);
    lines.forEach((line, index) => {
      parts.push(
        `<text class="${className}" x="${x}" y="${y + index * lineHeight}">` +
        `${escapeXml(line)}</text>`
      );
    });
    return { lines, height: Math.max(lineHeight, lines.length * lineHeight) };
  }

  function evidencePanelSummary(groups) {
    const panels = [...new Set((Array.isArray(groups) ? groups : [])
      .flatMap(group => Array.isArray(group?.panels) ? group.panels : [])
      .map(value => text(value, 40)).filter(Boolean))];
    const visible = panels.slice(0, 16);
    return visible.length
      ? `Panel ${visible.join('、')}${panels.length > visible.length
        ? ` 等 ${panels.length} 个` : ''}`
      : '未标注 Panel';
  }

  function roleLabel(value) {
    const normalized = text(value, 160).toLowerCase();
    return ({
      problem_setup: '问题建立',
      phenomenon: '现象发现',
      association: '关联证据',
      mechanism: '机制解析',
      causal_test: '因果检验',
      necessity: '必要性',
      sufficiency: '充分性',
      rescue: '挽救实验',
      functional_outcome: '功能结局',
      translation: '转化验证',
      mechanistic_support: '机制支持',
      intervention_effect: '干预效应',
      functional_validation: '功能验证',
      other: '综合证据'
    })[normalized] || text(value, 160) || '论证步骤';
  }

  function supplementalRoleLabel(value) {
    const normalized = text(value, 80).toLowerCase();
    return ({
      method_detail: '方法细节',
      control: '对照证据',
      robustness: '稳健性验证',
      extension: '结果延伸',
      mechanism_support: '机制补强',
      boundary: '边界证据',
      negative_result: '阴性结果',
      independent_support: '独立补充',
      uncertain: '待确认关联'
    })[normalized] || text(value, 80) || '补充证据';
  }

  function buildLegacyResearchLogicMapSvg(input) {
    const map = normalizeResearchLogicMap(input);
    const evidenceMode = map.view.mode === 'evidence';
    const width = 1920;
    const margin = 64;
    const contentWidth = width - margin * 2;
    const parts = [];
    let y = 54;

    parts.push(`<text class="title" x="${margin}" y="${y}">${escapeXml(map.meta.title)}</text>`);
    y += 40;
    parts.push(
      `<text class="subtitle" x="${margin}" y="${y}">${escapeXml(map.meta.articleTitle)}</text>`
    );
    y += 34;

    const overviewRows = map.steps.map((step, index) => ({
      label: `${index + 1}. ${step.figureLabel} · ${roleLabel(step.role || step.evidenceLevel)}`,
      lines: wrapSvgText(firstSentence(step.established, 520), contentWidth - 290, 21, 3)
    }));
    const overviewHeight = 58 + overviewRows.reduce(
      (sum, row) => sum + Math.max(34, row.lines.length * 29 + 8), 0
    );
    parts.push(
      `<rect x="${margin}" y="${y}" width="${contentWidth}" height="${overviewHeight}" rx="20" fill="#ffffff" stroke="#c7d7e0"/>`,
      `<text class="section-title" x="${margin + 24}" y="${y + 38}">分步论证摘要</text>`
    );
    let overviewY = y + 70;
    overviewRows.forEach(row => {
      parts.push(
        `<text class="overview-label" x="${margin + 28}" y="${overviewY}">${escapeXml(row.label)}</text>`
      );
      row.lines.forEach((line, lineIndex) => {
        parts.push(
          `<text class="overview-body" x="${margin + 276}" y="${overviewY + lineIndex * 29}">` +
          `${escapeXml(line)}</text>`
        );
      });
      overviewY += Math.max(34, row.lines.length * 29 + 8);
    });
    y += overviewHeight + 18;

    const mechanismEdges = map.meta.mechanismEdges?.length
      ? map.meta.mechanismEdges : deriveMechanismEdgesFromSteps(map.steps);
    const mechanismRows = mechanismEdges.length
      ? Array.from({ length: Math.ceil(mechanismEdges.length / 4) }, (_, index) =>
        mechanismEdges.slice(index * 4, index * 4 + 4))
      : [];
    const mechanism = map.meta.mechanismChain ||
      deriveMechanismChainFromSteps(map.steps) || '当前证据尚不足以形成单一机制链。';
    const mechanismLines = mechanismRows.length
      ? [] : wrapSvgText(mechanism, contentWidth - 210, 23, 4);
    const mechanismHeight = mechanismRows.length
      ? 58 + mechanismRows.length * 112
      : 58 + mechanismLines.length * 33;
    parts.push(
      `<rect x="${margin}" y="${y}" width="${contentWidth}" height="${mechanismHeight}" rx="20" fill="#eaf5f9" stroke="#b9d4df"/>`,
      `<text class="mechanism-label" x="${margin + 24}" y="${y + 40}">机制链</text>`
    );
    if (mechanismRows.length) {
      const chainX = margin + 150;
      const chainWidth = contentWidth - 180;
      mechanismRows.forEach((row, rowIndex) => {
        const arrowWidth = 138;
        const nodeWidth = (chainWidth - row.length * arrowWidth) / (row.length + 1);
        const rowY = y + 54 + rowIndex * 112;
        const nodes = [row[0].from, ...row.map(edge => edge.to)];
        nodes.forEach((node, nodeIndex) => {
          const nodeX = chainX + nodeIndex * (nodeWidth + arrowWidth);
          parts.push(
            `<rect x="${nodeX}" y="${rowY}" width="${nodeWidth}" height="72" rx="12" fill="#ffffff" stroke="#c2ddd7"/>`
          );
          wrapSvgText(node, nodeWidth - 20, 18, 2).forEach((line, lineIndex) => {
            parts.push(
              `<text class="mechanism-node" text-anchor="middle" x="${nodeX + nodeWidth / 2}" y="${rowY + 29 + lineIndex * 23}">${escapeXml(line)}</text>`
            );
          });
          if (nodeIndex < row.length) {
            const edge = row[nodeIndex];
            const arrowX = nodeX + nodeWidth + arrowWidth / 2;
            const refs = edge.supportPanels?.length
              ? compressPanelReferences(edge.supportPanels) : 'Panel 待补充';
            parts.push(
              `<text class="mechanism-panels" text-anchor="middle" x="${arrowX}" y="${rowY + 20}">${escapeXml(refs)}</text>`,
              `<text class="mechanism-arrow" text-anchor="middle" x="${arrowX}" y="${rowY + 53}">→</text>`
            );
          }
        });
      });
    } else {
      mechanismLines.forEach((line, lineIndex) => {
        parts.push(
          `<text class="mechanism" x="${margin + 166}" y="${y + 40 + lineIndex * 33}">` +
          `${escapeXml(line)}</text>`
        );
      });
    }
    y += mechanismHeight + 26;

    map.steps.forEach((step, index) => {
      if (!evidenceMode) {
        const labelWidth = 180;
        const gap = 26;
        const available = contentWidth - labelWidth - gap * 2 - 52;
        const questionWidth = Math.floor(available * 0.26);
        const establishedWidth = Math.floor(available * 0.46);
        const nextWidth = available - questionWidth - establishedWidth;
        const questionLines = wrapSvgText(step.question, questionWidth - 28, 21);
        const establishedLines = wrapSvgText(step.established, establishedWidth - 28, 21);
        const nextLines = wrapSvgText(step.nextQuestion, nextWidth - 28, 21);
        const panelSummaryLines = wrapSvgText(
          evidencePanelSummary(step.evidenceGroups), labelWidth - 52, 17, 3
        );
        const lineCount = Math.max(
          questionLines.length, establishedLines.length, nextLines.length
        );
        const mainStageHeight = Math.max(238, 104 + lineCount * 30);
        const supplementalColumns = Math.min(3, Math.max(1, step.supplemental.length));
        const supplementalRows = step.supplemental.length
          ? Math.ceil(step.supplemental.length / supplementalColumns) : 0;
        const supplementalHeight = supplementalRows ? 48 + supplementalRows * 132 : 0;
        const stageHeight = mainStageHeight + supplementalHeight;
        const cardX = margin;
        const contentX = cardX + labelWidth;
        const questionX = contentX + 26;
        const establishedX = questionX + questionWidth + gap;
        const nextX = establishedX + establishedWidth + gap;
        parts.push(
          `<rect x="${cardX}" y="${y}" width="${contentWidth}" height="${stageHeight}" rx="22" fill="#ffffff" stroke="#c6d5de"/>`,
          `<rect x="${cardX}" y="${y}" width="${labelWidth}" height="${mainStageHeight}" rx="22" fill="#e5f2f7"/>`,
          `<text class="figure" x="${cardX + 28}" y="${y + 54}">${escapeXml(step.figureLabel)}</text>`,
          `<text class="role" x="${cardX + 28}" y="${y + 88}">${escapeXml(roleLabel(step.role || step.evidenceLevel))}</text>`,
          `<text class="evidence-count" x="${cardX + 28}" y="${y + 124}">${step.evidenceGroups.length} 组证据</text>`,
          `<text class="label" x="${questionX}" y="${y + 42}">本图要回答</text>`,
          `<text class="label" x="${establishedX}" y="${y + 42}">本图结论</text>`,
          `<text class="label" x="${nextX}" y="${y + 42}">下一图要解决</text>`,
          `<line x1="${establishedX - 13}" y1="${y + 24}" x2="${establishedX - 13}" y2="${y + mainStageHeight - 24}" stroke="#e0e8ed"/>`,
          `<line x1="${nextX - 13}" y1="${y + 24}" x2="${nextX - 13}" y2="${y + mainStageHeight - 24}" stroke="#e0e8ed"/>`
        );
        panelSummaryLines.forEach((line, lineIndex) => {
          parts.push(
            `<text class="evidence-count" x="${cardX + 28}" y="${y + 153 + lineIndex * 24}">${escapeXml(line)}</text>`
          );
        });
        questionLines.forEach((line, lineIndex) => {
          parts.push(`<text class="body" x="${questionX}" y="${y + 80 + lineIndex * 30}">${escapeXml(line)}</text>`);
        });
        establishedLines.forEach((line, lineIndex) => {
          parts.push(`<text class="body strong" x="${establishedX}" y="${y + 80 + lineIndex * 30}">${escapeXml(line)}</text>`);
        });
        nextLines.forEach((line, lineIndex) => {
          parts.push(`<text class="body" x="${nextX}" y="${y + 80 + lineIndex * 30}">${escapeXml(line)}</text>`);
        });
        if (step.supplemental.length) {
          const supplementY = y + mainStageHeight;
          const supplementGap = 14;
          const supplementCardWidth = (
            contentWidth - 48 - supplementGap * (supplementalColumns - 1)
          ) / supplementalColumns;
          parts.push(
            `<rect x="${cardX}" y="${supplementY}" width="${contentWidth}" height="${supplementalHeight}" rx="0" fill="#fffaf0"/>`,
            `<line x1="${cardX}" y1="${supplementY}" x2="${cardX + contentWidth}" y2="${supplementY}" stroke="#e6d5aa"/>`,
            `<text class="supplement-heading" x="${cardX + 24}" y="${supplementY + 31}">附属补强证据 · 不参与主图推进</text>`
          );
          step.supplemental.forEach((item, supplementIndex) => {
            const column = supplementIndex % supplementalColumns;
            const row = Math.floor(supplementIndex / supplementalColumns);
            const supplementX = cardX + 24 + column * (supplementCardWidth + supplementGap);
            const cardY = supplementY + 44 + row * 132;
            const conclusion = wrapSvgText(item.conclusion, supplementCardWidth - 24, 17, 2);
            const limitation = wrapSvgText(item.limitation, supplementCardWidth - 24, 15, 1);
            parts.push(
              `<rect x="${supplementX}" y="${cardY}" width="${supplementCardWidth}" height="116" rx="12" fill="#ffffff" stroke="#e4cf99"/>`,
              `<text class="supplement-label" x="${supplementX + 12}" y="${cardY + 25}">${escapeXml(item.figureLabel || item.figureId)}</text>`,
              `<text class="supplement-role" text-anchor="end" x="${supplementX + supplementCardWidth - 12}" y="${cardY + 25}">${escapeXml(supplementalRoleLabel(item.supportRole || item.relationship))}</text>`
            );
            conclusion.forEach((line, lineIndex) => parts.push(
              `<text class="supplement-body" x="${supplementX + 12}" y="${cardY + 53 + lineIndex * 22}">${escapeXml(line)}</text>`
            ));
            if (limitation.length) parts.push(
              `<text class="supplement-boundary" x="${supplementX + 12}" y="${cardY + 103}">边界：${escapeXml(limitation[0])}</text>`
            );
          });
        }
        y += stageHeight;
      } else {
        const cardX = margin;
        const innerX = cardX + 28;
        const innerWidth = contentWidth - 56;
        const conclusionLines = wrapSvgText(step.established, innerWidth - 250, 21, 5);
        const groups = step.evidenceGroups.length ? step.evidenceGroups : [{
          title: '待补充证据组', panels: [], conclusion: '尚未填写证据组结论。'
        }];
        const groupLayouts = groups.map(group => {
          const titleLines = wrapSvgText(group.title, innerWidth - 250, 20, 3);
          const conclusionLines = wrapSvgText(group.conclusion, innerWidth - 70, 20, 8);
          const height = 72 + titleLines.length * 27 + conclusionLines.length * 28;
          return { group, titleLines, conclusionLines, height: Math.max(128, height) };
        });
        const stageHeaderHeight = 96 + conclusionLines.length * 30;
        const stageHeight = stageHeaderHeight +
          groupLayouts.reduce((sum, group) => sum + group.height + 12, 0) + 24;
        parts.push(
          `<rect x="${cardX}" y="${y}" width="${contentWidth}" height="${stageHeight}" rx="22" fill="#ffffff" stroke="#b9d3d1"/>`,
          `<rect x="${cardX}" y="${y}" width="${contentWidth}" height="${stageHeaderHeight}" rx="22" fill="#edf7f5"/>`,
          `<text class="figure" x="${innerX}" y="${y + 48}">${escapeXml(step.figureLabel)}</text>`,
          `<text class="role" x="${innerX + 150}" y="${y + 48}">${escapeXml(roleLabel(step.role || step.evidenceLevel))}</text>`,
          `<text class="label" x="${innerX}" y="${y + 82}">本图结论</text>`
        );
        conclusionLines.forEach((line, lineIndex) => {
          parts.push(
            `<text class="body strong" x="${innerX + 138}" y="${y + 82 + lineIndex * 30}">${escapeXml(line)}</text>`
          );
        });
        let groupY = y + stageHeaderHeight + 14;
        groupLayouts.forEach((layout, groupIndex) => {
          const panels = layout.group.panels?.length
            ? `Panel ${layout.group.panels.join('、')}` : '未标注 Panel';
          const supplementalGroup = layout.group.isSupplemental === true;
          parts.push(
            `<rect x="${innerX}" y="${groupY}" width="${innerWidth}" height="${layout.height}" rx="15" fill="${supplementalGroup ? '#fffaf0' : '#f7fbfa'}" stroke="${supplementalGroup ? '#e4cf99' : '#d0e2de'}"/>`,
            `<rect x="${innerX}" y="${groupY}" width="8" height="${layout.height}" rx="4" fill="${supplementalGroup ? '#c89637' : '#52a394'}"/>`,
            `<text class="group-index" x="${innerX + 24}" y="${groupY + 35}">${supplementalGroup ? '补充证据' : `证据组 ${groupIndex + 1}`}</text>`,
            `<text class="panels" x="${innerX + innerWidth - 24}" y="${groupY + 35}" text-anchor="end">${escapeXml(panels)}</text>`
          );
          layout.titleLines.forEach((line, lineIndex) => {
            parts.push(
              `<text class="group-title" x="${innerX + 150}" y="${groupY + 35 + lineIndex * 27}">${escapeXml(line)}</text>`
            );
          });
          const conclusionY = groupY + 52 + layout.titleLines.length * 27;
          layout.conclusionLines.forEach((line, lineIndex) => {
            parts.push(
              `<text class="body" x="${innerX + 24}" y="${conclusionY + lineIndex * 28}">${escapeXml(line)}</text>`
            );
          });
          groupY += layout.height + 12;
        });
        y += stageHeight;
      }

      if (index < map.steps.length - 1) {
        const next = map.steps[index + 1];
        const connectorLabel = firstSentence(next.question, 300) ||
          '因此下一图需要回答';
        y += 18;
        parts.push(
          `<line x1="${width / 2}" y1="${y}" x2="${width / 2}" y2="${y + 42}" stroke="#3b88a5" stroke-width="4"/>`,
          `<polygon points="${width / 2 - 9},${y + 34} ${width / 2 + 9},${y + 34} ${width / 2},${y + 49}" fill="#3b88a5"/>`,
          `<text class="connector" text-anchor="middle" x="${width / 2}" y="${y + 75}">下一图：${escapeXml(connectorLabel)}</text>`
        );
        y += 102;
      } else {
        y += 26;
      }
    });

    const boundaryLines = wrapSvgText(
      map.meta.claimBoundary || '尚未填写结论边界。', contentWidth - 210, 21
    );
    const boundaryHeight = 58 + boundaryLines.length * 30;
    parts.push(
      `<rect x="${margin}" y="${y}" width="${contentWidth}" height="${boundaryHeight}" rx="20" fill="#fff7ea" stroke="#e7c99e"/>`,
      `<text class="boundary-label" x="${margin + 24}" y="${y + 40}">结论边界</text>`
    );
    boundaryLines.forEach((line, lineIndex) => {
      parts.push(
        `<text class="body" x="${margin + 166}" y="${y + 40 + lineIndex * 30}">${escapeXml(line)}</text>`
      );
    });
    y += boundaryHeight + 54;

    const height = Math.ceil(y);
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<rect width="100%" height="100%" fill="#f4f8fa"/>',
      '<style>',
      'text{font-family:"Microsoft YaHei","Noto Sans CJK SC","Segoe UI",sans-serif;fill:#17384c}',
      '.title{font-size:38px;font-weight:800}.subtitle{font-size:19px;fill:#627b89}',
      '.section-title{font-size:23px;font-weight:800;fill:#0e4f75}',
      '.overview-label{font-size:20px;font-weight:800;fill:#174c6a}.overview-body{font-size:21px;fill:#294b5d}',
      '.mechanism-label,.boundary-label{font-size:21px;font-weight:800;fill:#176681}',
      '.mechanism{font-size:23px;font-weight:750;fill:#154a61}',
      '.mechanism-node{font-size:18px;font-weight:750;fill:#214f4a}',
      '.mechanism-panels{font-size:14px;font-weight:750;fill:#52796f}',
      '.mechanism-arrow{font-size:30px;font-weight:750;fill:#247a6f}',
      '.figure{font-size:28px;font-weight:850;fill:#0b5d86}.role{font-size:18px;font-weight:700;fill:#557484}',
      '.label{font-size:19px;font-weight:800;fill:#597482}.body{font-size:21px;fill:#294b5d}',
      '.strong{font-weight:700;fill:#173d4e}.evidence-count{font-size:17px;fill:#5b7481}',
      '.group-index{font-size:18px;font-weight:800;fill:#247769}.group-title{font-size:20px;font-weight:750;fill:#244d58}',
      '.panels{font-size:17px;font-weight:700;fill:#4d7d76}.connector{font-size:18px;font-weight:750;fill:#3b7183}',
      '.supplement-heading{font-size:17px;font-weight:800;fill:#80611f}',
      '.supplement-label{font-size:17px;font-weight:800;fill:#72530f}.supplement-role{font-size:14px;font-weight:700;fill:#96702a}',
      '.supplement-body{font-size:17px;fill:#5c5748}.supplement-boundary{font-size:13px;fill:#85775a}',
      '</style>',
      ...parts,
      '</svg>'
    ].join('');
  }

  function buildResearchLogicMapSvg(input) {
    const map = normalizeResearchLogicMap(input);
    const width = 1600;
    const margin = 60;
    const contentWidth = width - margin * 2;
    const parts = [];
    let y = 58;

    function addTextLines(value, x, startY, availableWidth, options = {}) {
      const fontSize = options.fontSize || 21;
      const lineHeight = options.lineHeight || 30;
      const lines = wrapSvgText(value, availableWidth, fontSize, options.maximumLines || 0);
      lines.forEach((line, index) => parts.push(
        `<text class="${options.className || 'body'}" x="${x}" ` +
        `y="${startY + index * lineHeight}">${escapeXml(line)}</text>`
      ));
      return Math.max(lineHeight, lines.length * lineHeight);
    }

    function addBulletSection(title, items, fill = '#ffffff') {
      const normalizedItems = (Array.isArray(items) ? items : [])
        .map(item => text(item?.text ?? item, 3000)).filter(Boolean);
      const layouts = (normalizedItems.length ? normalizedItems : ['—'])
        .map(item => wrapSvgText(item, contentWidth - 120, 21));
      const height = 62 + layouts.reduce(
        (sum, lines) => sum + Math.max(32, lines.length * 29) + 8,
        0
      );
      parts.push(
        `<rect x="${margin}" y="${y}" width="${contentWidth}" height="${height}" ` +
        `rx="18" fill="${fill}" stroke="#c5d6df"/>`,
        `<text class="section-title" x="${margin + 24}" y="${y + 39}">` +
        `${escapeXml(title)}</text>`
      );
      let itemY = y + 72;
      layouts.forEach(lines => {
        parts.push(`<text class="bullet" x="${margin + 30}" y="${itemY}">•</text>`);
        lines.forEach((line, lineIndex) => parts.push(
          `<text class="body" x="${margin + 58}" y="${itemY + lineIndex * 29}">` +
          `${escapeXml(line)}</text>`
        ));
        itemY += Math.max(32, lines.length * 29) + 8;
      });
      y += height + 22;
    }

    parts.push(
      `<text class="title" x="${margin}" y="${y}">${escapeXml(map.meta.title)}</text>`
    );
    y += 38;
    parts.push(
      `<text class="subtitle" x="${margin}" y="${y}">` +
      `${escapeXml(map.meta.articleTitle)}</text>`
    );
    y += 38;

    addBulletSection('已知背景', map.meta.backgroundItems, '#f7fbfd');
    addBulletSection('科学问题', map.meta.scientificQuestions, '#eef7fb');

    if (map.meta.mechanismEdges.length) {
      const rowHeight = 104;
      const height = 62 + map.meta.mechanismEdges.length * rowHeight;
      parts.push(
        `<rect x="${margin}" y="${y}" width="${contentWidth}" height="${height}" ` +
        'rx="18" fill="#edf7f5" stroke="#b9d8d1"/>',
        `<text class="section-title" x="${margin + 24}" y="${y + 39}">机制链</text>`
      );
      map.meta.mechanismEdges.forEach((edge, index) => {
        const rowTop = y + 66 + index * rowHeight;
        const nodeY = rowTop + 10;
        const nodeHeight = 52;
        const nodeWidth = 430;
        const sourceX = margin + 44;
        const targetX = margin + contentWidth - nodeWidth - 44;
        const connectorStartX = sourceX + nodeWidth;
        const connectorEndX = targetX;
        const connectorY = nodeY + nodeHeight / 2;
        const dashed = edge.effect === 'associate' || edge.evidence !== 'strong';
        const evidenceClass = dashed ? 'is-weak' : 'is-strong';
        const dashAttribute = dashed ? ' stroke-dasharray="13 10"' : '';
        const relation = edge.effect === 'promote'
          ? '促进' : edge.effect === 'inhibit' ? '抑制' : '相关';
        const evidence = edge.evidence === 'strong' ? '强证据' : '弱证据';
        parts.push(
          `<rect class="mechanism-node-box" x="${sourceX}" y="${nodeY}" ` +
          `width="${nodeWidth}" height="${nodeHeight}" rx="12"/>`,
          `<rect class="mechanism-node-box" x="${targetX}" y="${nodeY}" ` +
          `width="${nodeWidth}" height="${nodeHeight}" rx="12"/>`,
          `<text class="mechanism-node" text-anchor="middle" ` +
          `x="${sourceX + nodeWidth / 2}" y="${nodeY + 33}">` +
          `${escapeXml(firstSentence(edge.sourceId, 42))}</text>`,
          `<text class="mechanism-node" text-anchor="middle" ` +
          `x="${targetX + nodeWidth / 2}" y="${nodeY + 33}">` +
          `${escapeXml(firstSentence(edge.targetId, 42))}</text>`,
          `<line class="mechanism-connector is-${edge.effect} ${evidenceClass}" ` +
          `x1="${connectorStartX}" y1="${connectorY}" ` +
          `x2="${connectorEndX}" y2="${connectorY}"${dashAttribute}` +
          `${edge.effect === 'inhibit'
            ? '' : ' marker-end="url(#mechanism-arrowhead)"'}/>`
        );
        if (edge.effect === 'inhibit') parts.push(
          `<line class="mechanism-inhibition-bar" x1="${connectorEndX}" ` +
          `y1="${connectorY - 13}" x2="${connectorEndX}" y2="${connectorY + 13}"/>`
        );
        const support = edge.supportPanels.length
          ? ` · ${compressPanelReferences(edge.supportPanels)}` : '';
        parts.push(
          `<text class="mechanism-meta" text-anchor="middle" ` +
          `x="${(connectorStartX + connectorEndX) / 2}" y="${connectorY + 34}">` +
          `${escapeXml(`${relation} · ${evidence}${support}`)}</text>`
        );
      });
      y += height + 22;
    }

    map.steps.forEach((step, stepIndex) => {
      const questionLayouts = (step.questionItems.length
        ? step.questionItems : [{ text: '—' }])
        .map(item => wrapSvgText(item.text, contentWidth - 180, 20));
      const proofLayouts = (step.proofItems.length
        ? step.proofItems : [{ text: '—' }])
        .map(item => wrapSvgText(item.text, contentWidth - 180, 21));
      const pointLayouts = step.evidenceGroups.flatMap((group, groupIndex) =>
        group.evidencePoints.map(point => {
          const locator = point.locator.kind === 'panels'
            ? `Panel ${point.locator.values.join('、') || '—'}`
            : point.locator.kind === 'time-range'
              ? `${point.locator.startSeconds}–${point.locator.endSeconds}s`
              : point.locator.value || '表格范围待补充';
          const value = `${locator} · ${point.observation || '观察待补充'}` +
            `${point.argumentRole ? ` · ${point.argumentRole}` : ''}` +
            `${point.limitation ? ` · 边界：${point.limitation}` : ''}`;
          return {
            label: `${groupIndex + 1}. ${group.title}`,
            lines: wrapSvgText(value, contentWidth - 230, 18)
          };
        })
      );
      const questionHeight = questionLayouts.reduce(
        (sum, lines) => sum + Math.max(28, lines.length * 28) + 6, 0
      );
      const proofHeight = proofLayouts.reduce(
        (sum, lines) => sum + Math.max(30, lines.length * 29) + 6, 0
      );
      const evidenceHeight = pointLayouts.length
        ? pointLayouts.reduce((sum, layout) =>
          sum + Math.max(30, layout.lines.length * 26) + 12, 0) + 42
        : 0;
      const height = 94 + questionHeight + proofHeight + evidenceHeight;
      parts.push(
        `<rect x="${margin}" y="${y}" width="${contentWidth}" height="${height}" ` +
        'rx="22" fill="#ffffff" stroke="#b9d3d1"/>',
        `<text class="figure" x="${margin + 26}" y="${y + 48}">` +
        `${escapeXml(step.figureLabel)}</text>`,
        `<text class="role" x="${margin + 260}" y="${y + 48}">` +
        `${escapeXml(roleLabel(step.role || step.evidenceLevel))}</text>`
      );
      let rowY = y + 88;
      parts.push(`<text class="label" x="${margin + 28}" y="${rowY}">本图要解决的问题</text>`);
      rowY += 32;
      questionLayouts.forEach(lines => {
        parts.push(`<text class="bullet" x="${margin + 36}" y="${rowY}">•</text>`);
        lines.forEach((line, lineIndex) => parts.push(
          `<text class="body" x="${margin + 64}" y="${rowY + lineIndex * 28}">` +
          `${escapeXml(line)}</text>`
        ));
        rowY += Math.max(28, lines.length * 28) + 6;
      });
      parts.push(`<text class="label" x="${margin + 28}" y="${rowY}">本图证明</text>`);
      rowY += 32;
      proofLayouts.forEach(lines => {
        parts.push(`<text class="bullet strong" x="${margin + 36}" y="${rowY}">•</text>`);
        lines.forEach((line, lineIndex) => parts.push(
          `<text class="body strong" x="${margin + 64}" y="${rowY + lineIndex * 29}">` +
          `${escapeXml(line)}</text>`
        ));
        rowY += Math.max(30, lines.length * 29) + 6;
      });
      if (pointLayouts.length) {
        parts.push(`<text class="label" x="${margin + 28}" y="${rowY}">证据组与证据点</text>`);
        rowY += 34;
        pointLayouts.forEach(layout => {
          parts.push(
            `<text class="group-index" x="${margin + 42}" y="${rowY}">` +
            `${escapeXml(layout.label)}</text>`
          );
          layout.lines.forEach((line, lineIndex) => parts.push(
            `<text class="evidence" x="${margin + 260}" y="${rowY + lineIndex * 26}">` +
            `${escapeXml(line)}</text>`
          ));
          rowY += Math.max(30, layout.lines.length * 26) + 12;
        });
      }
      y += height;
      if (stepIndex < map.steps.length - 1) {
        parts.push(
          `<line x1="${width / 2}" y1="${y}" x2="${width / 2}" y2="${y + 42}" ` +
          'stroke="#3b88a5" stroke-width="4"/>',
          `<polygon points="${width / 2 - 9},${y + 34} ${width / 2 + 9},${y + 34} ` +
          `${width / 2},${y + 50}" fill="#3b88a5"/>`
        );
        y += 70;
      } else {
        y += 22;
      }
    });

    if (map.supplementalMaterials.length) {
      addBulletSection('补充材料', map.supplementalMaterials.map(item => ({
        text: `${item.type} · ${item.label}`
      })), '#fffaf0');
    }
    addBulletSection('最终结论（对应科学问题）',
      map.meta.finalConclusions.map(item => ({
        text: `${item.text}${item.questionIds.length
          ? ` [${item.questionIds.join('、')}]` : ''}`
      })), '#fff7ea');
    if (map.meta.claimBoundary) {
      addBulletSection('结论边界', [{ text: map.meta.claimBoundary }], '#fffaf2');
    }

    const height = Math.ceil(y + 24);
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}">`,
      '<defs><marker id="mechanism-arrowhead" markerWidth="12" markerHeight="12" ' +
      'refX="10" refY="6" orient="auto" markerUnits="strokeWidth">' +
      '<path d="M1,1 L11,6 L1,11 z" fill="#247a6f"/></marker></defs>',
      '<rect width="100%" height="100%" fill="#f4f8fa"/>',
      '<style>',
      'text{font-family:"Microsoft YaHei","Noto Sans CJK SC","Segoe UI",sans-serif;fill:#17384c}',
      '.title{font-size:38px;font-weight:800}.subtitle{font-size:19px;fill:#627b89}',
      '.section-title{font-size:23px;font-weight:800;fill:#0e4f75}',
      '.figure{font-size:28px;font-weight:850;fill:#0b5d86}.role{font-size:18px;font-weight:700;fill:#557484}',
      '.label{font-size:19px;font-weight:800;fill:#597482}.body{font-size:21px;fill:#294b5d}',
      '.bullet{font-size:24px;fill:#3b88a5}.strong{font-weight:750;fill:#173d4e}',
      '.group-index{font-size:18px;font-weight:800;fill:#247769}.evidence{font-size:18px;fill:#365d66}',
      '.mechanism-node{font-size:20px;font-weight:750;fill:#214f4a}',
      '.mechanism-node-box{fill:#fff;stroke:#b9d8d1;stroke-width:2}',
      '.mechanism-connector,.mechanism-inhibition-bar{stroke:#247a6f;stroke-width:4;fill:none}',
      '.mechanism-meta{font-size:16px;fill:#52796f}',
      '</style>',
      ...parts,
      '</svg>'
    ].join('');
  }

  return {
    RESEARCH_LOGIC_MAP_KIND,
    RESEARCH_LOGIC_MAP_SCHEMA_VERSION,
    RESEARCH_LOGIC_MAP_INDEX_PATH,
    researchLogicMapFingerprint,
    researchLogicMapAssetPath,
    normalizeTextItems,
    normalizeScientificQuestions,
    normalizeFinalConclusions,
    normalizeEvidenceLocator,
    normalizeEvidencePoint,
    normalizeEvidenceGroupV3,
    normalizeMechanismEdges,
    normalizeResearchLogicMap,
    createResearchLogicMapFromFigures,
    createBlankResearchLogicMap,
    updateScientificQuestion,
    updateFinalConclusion,
    normalizeResearchLogicMapIndex,
    upsertResearchLogicMapIndex,
    buildResearchLogicMapSvg
  };
});
