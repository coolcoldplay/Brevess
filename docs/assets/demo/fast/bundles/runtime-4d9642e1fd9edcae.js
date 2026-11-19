
;/* native/core/mechanism-pending-preview.js */
(function attach(root, factory) {
  const api = factory(root.SciLLM || {}, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared, host) {
  'use strict';
  const t = value => host.SciLLM?.translateInterfaceText?.(value) || value;
  const authored = node => { node.setAttribute('data-i18n-ignore', ''); return node; };

  const RELATION_KIND = Object.freeze({ causal: '因果', correlative: '相关' });
  const POLARITY = Object.freeze({
    increases: '促进', decreases: '抑制', no_change: '未见变化',
    mixed: '方向不一致', unknown: '方向未确定'
  });
  const EVIDENCE_CLASS = Object.freeze({
    sufficiency: '充分性', necessity: '必要性', other: '其他证据'
  });
  const ROLE = Object.freeze({ supporting: '支持', counterclaim: '反向证据' });
  const USAGE_KIND = Object.freeze({
    counterevidence: '无关系反向证据', inconclusive: '证据不足',
    null_result: '无显著关系', localization: '定位证据',
    node_observation: '节点观察'
  });
  const PANEL_STATUS = Object.freeze({
    linked_causal: '已关联因果关系', linked_correlative: '已关联相关关系',
    node_evidence: '节点证据（无关系边）',
    excluded_schematic: '来源支持的示意图（不构成关系证据）',
    unresolved: '未解析'
  });
  const REVIEW_REASON = Object.freeze({
    intervention_direction_conflict: '干预对象与关系方向冲突，需核对原文',
    unmapped_relation_term: '关系端点或方向尚未可靠对应',
    missing_relation_mapping: '尚未完成关系对应',
    source_backed_schematic: '原文中的实验示意图',
    incompatible_panel_claims: '同一 Panel 的结论存在冲突',
    unqualified_causal_test: '现有实验设计不足以支持因果关系'
  });

  function reviewReason(value) { return REVIEW_REASON[value] ? t(REVIEW_REASON[value]) : value; }

  function text(value, fallback = '') {
    const normalized = String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    return normalized || fallback;
  }

  function normalizePreview(value) {
    if (typeof shared.normalizeGeneratedMechanismPreview !== 'function') return null;
    try {
      return shared.normalizeGeneratedMechanismPreview(value, 'node-v2');
    } catch (_) {
      return null;
    }
  }

  function relationNature(relation) {
    const status = relation.relationStatus === 'counter_only'
      ? '仅有反向证据，不绘入已确认机制' : '有支持证据';
    return `${t(RELATION_KIND[relation.relationKind] || '关系性质未确定')} · ` +
      `${t(POLARITY[relation.polarity] || '方向未确定')} · ${t(status)}`;
  }

  function relationContext(relation) {
    const fields = [
      ['物种', relation.context.species], ['组织', relation.context.tissue],
      ['细胞', relation.context.cellType], ['区室', relation.context.compartment],
      ['条件', relation.context.condition], ['时间', relation.context.timepoint],
      ['剂量', relation.context.dose]
    ].filter(([, value]) => text(value));
    return fields.length
      ? fields.map(([label, value]) => `${t(label)}: ${text(value)}`).join('; ')
      : t('实验上下文未提供');
  }

  function panelEvidenceItem(assignment) {
    const references = assignment.sourceRefs.length
      ? `; ${t('来源')}: ${assignment.sourceRefs.join('、')}` : `; ${t('来源定位未提供')}`;
    return {
      panelKey: assignment.panelKey,
      evidenceClass: t(EVIDENCE_CLASS[assignment.evidenceClass] || '证据类型未确定'),
      role: t(ROLE[assignment.role] || '作用未确定'),
      sourceRefs: [...assignment.sourceRefs],
      label: `${assignment.panelKey} · ${t(EVIDENCE_CLASS[assignment.evidenceClass] || '证据类型未确定')}` +
        ` · ${t(ROLE[assignment.role] || '作用未确定')}${references}`
    };
  }

  function createMechanismPendingPreviewModel(value) {
    const preview = normalizePreview(value);
    if (!preview) return null;
    const nodesById = new Map(preview.nodes.map(node => [node.nodeId, node]));
    const claimsById = new Map(preview.claims.map(claim => [claim.claimId, claim]));
    const relationsById = new Map(preview.relations.map(relation => [
      relation.relationId, relation
    ]));
    const label = nodeId => nodesById.get(nodeId)?.label || t('未知节点');
    const relations = preview.relations.map(relation => {
      const evidence = relation.assignments.map(panelEvidenceItem);
      return {
        relationId: relation.relationId,
        sourceNodeId: relation.sourceNodeId,
        sourceLabel: label(relation.sourceNodeId),
        targetNodeId: relation.targetNodeId,
        targetLabel: label(relation.targetNodeId),
        relationKind: relation.relationKind,
        relationStatus: relation.relationStatus,
        renderable: relation.renderable === true,
        polarity: relation.polarity,
        nature: relationNature(relation),
        context: relationContext(relation),
        evidence,
        panels: evidence.map(item => item.label)
      };
    });
    const connectedNodeIds = new Set(relations.flatMap(relation => [
      relation.sourceNodeId, relation.targetNodeId
    ]));
    const connectedNodes = preview.nodes.filter(node => connectedNodeIds.has(node.nodeId));
    const disconnectedNodes = preview.nodes.filter(node => !connectedNodeIds.has(node.nodeId));
    const graph = {
      schema: 'brevess.mechanism-graph',
      schemaVersion: 1,
      // Keep the relationship graph compact. Node-only evidence remains available
      // in disconnectedNodes and the expandable audit region below the graph.
      nodes: connectedNodes.map(node => ({ id: node.nodeId, label: node.label })),
      // A pending counter-only relationship remains visible as contested evidence.
      // The preview is explicitly read-only and is never projected into the saved chain.
      edges: preview.relations.map(relation => ({
        id: relation.relationId,
        from: relation.sourceNodeId,
        to: relation.targetNodeId,
        label: relation.polarity,
        lineStyle: relation.relationKind === 'correlative' ? 'dashed' : 'solid',
        contested: relation.relationStatus === 'counter_only',
        codes: [],
        polarity: relation.polarity === 'increases' ? 'positive'
          : relation.polarity === 'decreases' ? 'negative' : 'neutral'
      }))
    };
    const nonRelationEvidence = [];
    const dispositionsByPanel = new Map((preview.panelDispositions || []).map(item => [
      item.panelKey, item
    ]));
    for (const usage of preview.claimUsages || []) {
      if (usage.relationIds.length) continue;
      const claim = claimsById.get(usage.claimId);
      const disposition = dispositionsByPanel.get(usage.panelKey);
      const reason = disposition?.reason ? `; ${t('原因')}: ${reviewReason(disposition.reason)}` : '';
      nonRelationEvidence.push({
        key: `usage:${usage.claimId}`,
        panelKey: usage.panelKey,
        kind: t(USAGE_KIND[usage.usageKind] || '无关系证据'),
        nodes: usage.nodeIds.map(label),
        detail: claim?.sourceRefs?.length
          ? `${t('来源')}: ${claim.sourceRefs.join('、')}${reason}` : `${t('来源定位未提供')}${reason}`
      });
    }
    for (const unresolved of preview.unresolvedClaims || []) {
      const claim = claimsById.get(unresolved.claimId);
      nonRelationEvidence.push({
        key: `unresolved:${unresolved.claimId}`,
        panelKey: unresolved.panelKey,
        kind: t('未解析证据'),
        nodes: [],
        detail: `${t('原因')}: ${reviewReason(unresolved.reason)}` +
          (claim?.sourceRefs?.length ? `; ${t('来源')}: ${claim.sourceRefs.join('、')}` : '')
      });
    }
    const representedPanels = new Set([
      ...relations.flatMap(relation => relation.panels.map(item => item.split(' · ')[0])),
      ...nonRelationEvidence.map(item => item.panelKey)
    ]);
    for (const disposition of preview.panelDispositions || []) {
      if (representedPanels.has(disposition.panelKey)) continue;
      const related = disposition.relationIds.map(id => relationsById.get(id))
        .filter(Boolean).map(relation =>
          `${label(relation.sourceNodeId)} → ${label(relation.targetNodeId)}`);
      nonRelationEvidence.push({
        key: `panel:${disposition.panelKey}`,
        panelKey: disposition.panelKey,
        kind: t(PANEL_STATUS[disposition.status] || 'Panel 状态未确定'),
        nodes: disposition.nodeIds.map(label),
        detail: related.length ? `${t('候选关系')}: ${related.join('；')}`
          : disposition.reason ? `${t('原因')}: ${reviewReason(disposition.reason)}` : t('未形成关系边')
      });
    }
    const allKnownPanels = new Set([
      ...preview.claims.map(claim => claim.panelKey),
      ...(preview.panelDispositions || []).map(item => item.panelKey)
    ]);
    return {
      status: preview.status,
      canonicalDigest: preview.canonicalDigest,
      nodes: preview.nodes.map(node => ({ ...node })),
      connectedNodes: connectedNodes.map(node => ({ ...node })),
      disconnectedNodes: disconnectedNodes.map(node => ({ ...node })),
      relations,
      graph,
      nonRelationEvidence,
      panelCount: allKnownPanels.size,
      panelCoverageKnown: Array.isArray(preview.panelDispositions),
      mermaidDefinition: typeof shared.createMechanismAuditMermaidDefinition === 'function'
        ? shared.createMechanismAuditMermaidDefinition(graph, {
            direction: 'LR', language: host.SciLLM?.getInterfaceLanguage?.() || 'zh-CN', generatedRelationLabels: true
          }) : ''
    };
  }

  function element(tag, className = '', content = undefined) {
    const node = host.document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  }

  const initializedMermaidRenderers = new WeakSet();

  function normalizeMermaidLabelLineBreaks(source) {
    const original = String(source ?? '');
    if (original.length > 20000 || !/^\s*(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)\b/u.test(original) ||
        /%%\s*\{|^\s*---/mu.test(original)) return original;
    const normalizeLabel = label => {
      const quoted = label.startsWith('"') && label.endsWith('"');
      const body = quoted ? label.slice(1,-1) : label;
      const markdown = quoted && body.startsWith('`') && body.endsWith('`');
      const content = markdown ? body.slice(1,-1) : body;
      if (content.includes('`') || content.includes('$$') ||
          /\\(?:nabla|nu|neg|not|neq|newcommand|newline|nolimits|nexists|notin)\b/u.test(content) ||
          /\b[A-Za-z]:\\/u.test(content) || /^\/.*\/[dgimsuvy]*$/u.test(content) ||
          /\\[dDsSwWbB]/u.test(content)) return label;
      const next = content.replace(/(?<!\\)\\n/gu, markdown ? '\n' : '<br/>');
      return markdown ? '"`' + next + '`"' : quoted ? '"' + next + '"' : next;
    };
    const shapes = [['[[',']]'],['((', '))'],['{{','}}'],['([','])'],['[/','/]'],['[\\','\\]'],
      ['[',']'],['(',')'],['{','}'],['>',']']];
    let invalid = false;
    const result = original.split('\n').map(line => {
      if (/^\s*(?:%%|style\b|classDef\b|class\b|click\b|linkStyle\b|subgraph\b|end\b)/u.test(line)) return line;
      let output = '', cursor = 0;
      while (cursor < line.length) {
        if (line.slice(cursor,cursor+2) === '%%') { output += line.slice(cursor); break; }
        if (line[cursor] === '"' && /(?:--|==|-\.)\s*$/u.test(line.slice(0,cursor))) {
          let end = cursor + 1;
          for (; end < line.length; end++) {
            if (line[end] === '\\') { end++; continue; }
            if (line[end] === '"') break;
          }
          if (end < line.length && /^\s*(?:-->|==>|-\.->)/u.test(line.slice(end+1))) {
            output += normalizeLabel(line.slice(cursor,end+1)); cursor = end+1; continue;
          }
        }
        const node = /^(?:[A-Za-z_][\w.-]*)\s*/u.exec(line.slice(cursor));
        const shape = node && shapes.find(([open]) => line.startsWith(open,cursor+node[0].length));
        const edge = line[cursor] === '|' && /(?:-->|---|==>|-\.->)\s*$/u.test(line.slice(0,cursor));
        if (!shape && !edge) {
          const length = node ? node[0].length : 1;
          output += line.slice(cursor,cursor+length); cursor += length; continue;
        }
        const open = edge ? '|' : shape[0], close = edge ? '|' : shape[1];
        const start = cursor + (edge ? 1 : node[0].length + open.length);
        let end = start, quote = false;
        for (; end < line.length; end++) {
          if (line[end] === '\\') { end++; continue; }
          if (line[end] === '"') quote = !quote;
          if (!quote && line.startsWith(close,end)) break;
        }
        if (end >= line.length || quote) { invalid = true; return line; }
        output += line.slice(cursor,start) + normalizeLabel(line.slice(start,end)) + close;
        cursor = end + close.length;
      }
      return output;
    }).join('\n');
    return invalid ? original : result;
  }

  async function renderMechanismDiagramInMeasurableHost(diagram, options = {}) {
    const mermaid = options.mermaid || host.mermaid;
    if (!diagram || typeof mermaid?.run !== 'function' || !host.document?.body) return false;
    // Display adaptation only. Callers keep the original definition separately.
    const definition = String(diagram.textContent || '');
    const displayDefinition = normalizeMermaidLabelLineBreaks(definition);
    if (displayDefinition !== definition) diagram.textContent = displayDefinition;
    if (!initializedMermaidRenderers.has(mermaid)) {
      mermaid.initialize?.({
        startOnLoad: false, securityLevel: 'strict', theme: 'base',
        flowchart: { curve: 'basis', htmlLabels: false },
        themeVariables: {
          primaryColor: '#eef7fa', primaryBorderColor: '#166585',
          primaryTextColor: '#16384b', lineColor: '#4f7181',
          fontFamily: 'Inter, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif'
        }
      });
      initializedMermaidRenderers.add(mermaid);
    }
    const parent = diagram.parentNode;
    const placeholder = element('span', 'mechanism-diagram-render-placeholder');
    placeholder.hidden = true;
    parent?.insertBefore(placeholder, diagram);
    const staging = element('div', 'mechanism-diagram-render-staging');
    staging.style.position = 'fixed';
    staging.style.left = '-10000px';
    staging.style.top = '0';
    staging.style.width = '960px';
    staging.style.visibility = 'hidden';
    staging.setAttribute('aria-hidden', 'true');
    staging.append(diagram);
    host.document.body.append(staging);
    try {
      await mermaid.run({ nodes: [diagram], suppressErrors: true });
      const svg = diagram.querySelector('svg');
      const viewBox = svg?.viewBox?.baseVal;
      const invalid = !svg || !(viewBox?.width > 0 && viewBox?.height > 0) ||
        [...svg.querySelectorAll('[d], [transform]')].some(node =>
          /(?:NaN|Infinity|undefined)/u.test(
            `${node.getAttribute('d') || ''} ${node.getAttribute('transform') || ''}`
          ));
      if (invalid) throw new Error('MECHANISM_DIAGRAM_GEOMETRY_INVALID');
      return true;
    } finally {
      // A snapshot redraw can remove the original target while Mermaid runs.
      // Only the still-owned placeholder may receive this asynchronous result.
      if (parent && placeholder.parentNode === parent) parent.replaceChild(diagram, placeholder);
      else diagram.remove();
      staging.remove();
    }
  }

  function appendList(container, items, emptyText) {
    if (!items.length) {
      container.append(element('p', 'workspace-mechanism-matrix-help', emptyText));
      return;
    }
    const list = element('ul', 'workspace-mechanism-audit-list');
    for (const item of items) list.append(authored(element('li', '', item)));
    container.append(list);
  }

  function createEvidenceTable(model) {
    const section = element('section', 'workspace-mechanism-matrix-section mechanism-pending-preview-evidence');
    section.append(element('h3', '', '关系与 Panel 证据'));
    const help = model.panelCoverageKnown
      ? `预览记录了 ${model.panelCount} 个 Panel；下表同时保留未解析和未形成关系的证据。`
      : `预览引用了 ${model.panelCount} 个 Panel；缺少完整 Panel 处置清单，无法确认是否覆盖全部已读 Panel。`;
    section.append(element('p', 'workspace-mechanism-matrix-help', help));
    const scroll = element('div', 'workspace-mechanism-matrix-scroll');
    const table = element('table', 'workspace-mechanism-matrix mechanism-pending-preview-table');
    table.setAttribute('aria-label', '待核验关系与 Panel 证据');
    const head = element('thead');
    const headingRow = element('tr');
    for (const label of ['上游节点', '关系性质', '下游节点', 'Panel 证据', '实验上下文']) {
      headingRow.append(element('th', '', label));
    }
    head.append(headingRow);
    const body = element('tbody');
    for (const relation of model.relations) {
      const row = element('tr');
      row.dataset.relationId = relation.relationId;
      const source = authored(element('td', 'mechanism-pending-preview-source', relation.sourceLabel));
      source.dataset.label = '上游节点';
      const nature = element('td', 'mechanism-pending-preview-nature', relation.nature);
      nature.dataset.label = '关系性质';
      const target = authored(element('td', 'mechanism-pending-preview-target', relation.targetLabel));
      target.dataset.label = '下游节点';
      const panels = element('td', 'mechanism-pending-preview-panels');
      panels.dataset.label = '支持 Panel 与来源';
      if (!relation.evidence.length) {
        panels.append(element('p', 'workspace-mechanism-matrix-help',
          '该候选关系没有可列出的 Panel 证据。'));
      } else {
        const list = element('ul', 'mechanism-pending-preview-panel-list');
        for (const evidence of relation.evidence) {
          const item = element('li', 'mechanism-pending-preview-panel-item');
          const heading = element('div', 'mechanism-pending-preview-panel-heading');
          heading.append(
            authored(element('strong', 'mechanism-pending-preview-panel-key', evidence.panelKey)),
            element('span', 'mechanism-pending-preview-panel-role',
              `${evidence.evidenceClass} · ${evidence.role}`)
          );
          const separator = evidence.panelKey.lastIndexOf(':');
          const action = element('button',
            'mechanism-pending-preview-source-action mechanism-pending-preview-source-button',
            '查看 Panel');
          action.type = 'button';
          if (separator > 0 && separator < evidence.panelKey.length - 1) {
            action.dataset.mechanismSourcePanel = evidence.panelKey;
            action.dataset.figureId = evidence.panelKey.slice(0, separator);
            action.dataset.panelId = evidence.panelKey.slice(separator + 1);
            action.title = `在 Figure 工作区定位 ${evidence.panelKey}`;
            action.setAttribute('aria-label', action.title);
          } else {
            action.disabled = true;
          }
          heading.append(action);
          item.append(heading);
          const sources = element('details', 'mechanism-pending-preview-source-refs');
          sources.append(element('summary', '', evidence.sourceRefs.length
            ? `来源字段 ${evidence.sourceRefs.length}` : '来源定位未提供'));
          if (evidence.sourceRefs.length) {
            const sourceList = element('ul', 'workspace-mechanism-audit-list');
            for (const sourceRef of evidence.sourceRefs) sourceList.append(authored(element('li', '', sourceRef)));
            sources.append(sourceList);
          }
          item.append(sources);
          list.append(item);
        }
        panels.append(list);
      }
      const context = authored(element('td', 'mechanism-pending-preview-context', relation.context));
      context.dataset.label = '实验上下文';
      row.append(source, nature, target, panels, context);
      body.append(row);
    }
    if (!model.relations.length) {
      const row = element('tr');
      const cell = element('td', '', '尚无候选关系；节点和无关系证据仍保留在本预览中。');
      cell.colSpan = 5;
      row.append(cell);
      body.append(row);
    }
    table.append(head, body);
    scroll.append(table);
    section.append(scroll);
    return section;
  }

  function createMechanismPendingPreviewSection(value, options = {}) {
    const model = createMechanismPendingPreviewModel(value);
    if (!model || !host.document?.createElement) return null;
    const section = element('section', 'workspace-mechanism-synthesis mechanism-pending-preview');
    section.setAttribute('data-brevess-interface', '');
    section.dataset.previewStatus = model.status;
    section.dataset.canonicalDigest = model.canonicalDigest;
    const heading = element('header', 'mechanism-pending-preview-heading');
    heading.append(
      options.title ? authored(element('h3', '', options.title)) : element('h3', '', '待核验预览（尚未替换已保存机制网络）'),
      element('p', 'workspace-mechanism-matrix-help',
        '此处仅展示生成候选；核验完成前，已保存机制网络保持不变。')
    );
    section.append(heading);

    const graphSection = element('section', 'workspace-mechanism-mermaid-section');
    graphSection.append(element('h3', '', '候选节点与关系'));
    const graphHelp = model.relations.length
      ? `优先显示 ${model.connectedNodes.length} 个关系节点和 ${model.relations.length} 条候选关系；` +
        `${model.disconnectedNodes.length} 个未形成关系的节点保留在下方。`
      : `共 ${model.nodes.length} 个节点；当前没有候选关系边。`;
    graphSection.append(element('p', 'workspace-mechanism-matrix-help', graphHelp));
    const diagram = element('div', 'mermaid workspace-mechanism-mermaid mechanism-pending-preview-diagram');
    diagram.dataset.pendingPreviewDiagram = 'true';
    diagram.dataset.viewMode = 'fit-width';
    if (model.mermaidDefinition) { authored(diagram); diagram.textContent = model.mermaidDefinition; }
    else {
      diagram.classList.remove('mermaid');
      diagram.textContent = model.relations.length
        ? '机制图组件尚未就绪；请使用下方节点、关系和证据表核验。'
        : '当前仅有节点证据；未生成关系边。';
    }
    graphSection.append(diagram);
    const nodeRegion = element('details',
      'workspace-mechanism-audit-region mechanism-pending-preview-nodes');
    nodeRegion.append(element('summary', '',
      `未形成关系的候选节点（${model.disconnectedNodes.length}）`));
    appendList(nodeRegion, model.disconnectedNodes.map(node =>
      `${node.label} (${t(({ entity: '生物实体', intervention: '干预', outcome: '结果',
        state: '状态', process: '过程' })[node.nodeType] || '机制节点')})`), '没有可展示的候选节点。');
    graphSection.append(nodeRegion);
    section.append(graphSection, createEvidenceTable(model));

    const nonRelation = element('section',
      'workspace-mechanism-audit-region mechanism-pending-preview-nonrelation');
    const nonRelationDetails = element('details', 'mechanism-pending-preview-nonrelation-details');
    nonRelationDetails.append(element('summary', '',
      `未解析或无关系的 Panel 证据（${model.nonRelationEvidence.length}）`));
    appendList(nonRelationDetails, model.nonRelationEvidence.map(item => {
      const nodes = item.nodes.length ? `; ${t('节点')}: ${item.nodes.join('、')}` : '';
      return `${item.panelKey} · ${item.kind}${nodes}；${item.detail}`;
    }), '没有记录未解析或无关系的 Panel 证据。');
    nonRelation.append(nonRelationDetails);
    section.append(nonRelation);
    Object.defineProperty(section, 'pendingPreviewModel', { value: model });
    return section;
  }

  async function renderMechanismPendingPreview(value, options = {}) {
    const section = createMechanismPendingPreviewSection(value, options);
    if (!section) return null;
    const requestedMount = options.mount;
    const mount = requestedMount && typeof requestedMount.append === 'function'
      ? requestedMount : null;
    if (mount) {
      mount.append(section);
    }
    const diagram = section.querySelector('[data-pending-preview-diagram]');
    const mermaid = options.mermaid || host.mermaid;
    if (!diagram?.classList.contains('mermaid') || typeof mermaid?.run !== 'function') {
      return section;
    }
    try {
      await renderMechanismDiagramInMeasurableHost(diagram, { mermaid });
      diagram.querySelector('svg')?.setAttribute('aria-label', '待核验机制节点与关系图');
    } catch (_) {
      diagram.classList.remove('mermaid');
      diagram.removeAttribute('data-i18n-ignore');
      diagram.textContent = '候选关系图渲染失败；节点、关系和 Panel 证据仍可在下方核验。';
    }
    return section;
  }

  return {
    normalizeMermaidLabelLineBreaks,
    createMechanismPendingPreviewModel,
    createMechanismPendingPreviewSection,
    renderMechanismDiagramInMeasurableHost,
    renderMechanismPendingPreview
  };
});


;/* native/core/manual-annotations.js */
(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const MAX_NOTE_LENGTH = 4000;
  const WARNING_ANNOTATIONS_PER_DOCUMENT = 1000;
  const MAX_ANNOTATIONS_PER_DOCUMENT = 2000;
  const DOCUMENT_TEXT_FINGERPRINT_LENGTH = 8000;
  const STUDY_TYPE_IDS = new Set([
    'basic_mechanistic', 'preclinical_translational', 'observational',
    'clinical_trial', 'diagnostic_prognostic', 'omics_high_throughput',
    'narrative_review', 'systematic_review_meta', 'methods_resource'
  ]);

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cloneJsonLike(value) {
    if (Array.isArray(value)) return value.map(cloneJsonLike);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)])
    );
  }

  function unicodeText(value) {
    return String(value ?? '').normalize('NFKC');
  }

  function rawText(value) {
    return String(value ?? '');
  }

  function normalizeWhitespace(value) {
    return unicodeText(value).replace(/\s+/gu, ' ').trim();
  }

  function normalizeCanonicalUrl(value) {
    const raw = unicodeText(value).trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/.test(parsed.protocol)) return '';
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      parsed.search = '';
      const pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
      return `${parsed.origin}${pathname === '/' ? '' : pathname}`;
    } catch (_) {
      return raw.split(/[?#]/u, 1)[0].replace(/\/+$/, '');
    }
  }

  function normalizeAnnotationSourceUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (!['http:', 'https:', 'file:'].includes(url.protocol)) return '';
      url.username = ''; url.password = '';
      // Fragment navigation is the same document; hash-router views are not.
      if (!/^#!?\//.test(url.hash)) url.hash = '';
      return url.href;
    } catch (_) { return ''; }
  }

  function normalizeDoi(value, canonicalUrl) {
    let doi = unicodeText(value).trim();
    if (!doi) {
      try {
        const parsed = new URL(unicodeText(canonicalUrl).trim());
        if (/^(?:dx\.)?doi\.org$/i.test(parsed.hostname)) {
          doi = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
        }
      } catch (_) {}
    }
    return doi
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '')
      .replace(/^doi\s*:\s*/iu, '')
      .split(/[?#]/u, 1)[0]
      .trim()
      .toLocaleLowerCase('en-US');
  }

  function bytesToHex(bytes) {
    return [...new Uint8Array(bytes)]
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  }

  async function digestHex(value) {
    if (typeof shared.sha256Hex === 'function') {
      const digest = await shared.sha256Hex(value);
      const normalized = String(digest || '').replace(/^sha256:/i, '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(normalized)) fail('INVALID_SHA256_DIGEST');
      return normalized;
    }
    let subtle = globalThis.crypto?.subtle;
    if (!subtle && typeof require === 'function') {
      subtle = require('node:crypto').webcrypto.subtle;
    }
    if (!subtle) fail('SHA256_UNAVAILABLE');
    const encoded = new TextEncoder().encode(value);
    return bytesToHex(await subtle.digest('SHA-256', encoded));
  }

  async function createDocumentId(input = {}) {
    const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs : [];
    const normalizedBody = normalizeWhitespace(
      paragraphs.map(paragraph => paragraph?.text || '').join(' ')
    ).slice(0, DOCUMENT_TEXT_FINGERPRINT_LENGTH);
    const identity = JSON.stringify({
      title: normalizeWhitespace(input.title).toLocaleLowerCase('en-US'),
      canonicalUrl: normalizeCanonicalUrl(input.canonicalUrl || input.url),
      doi: normalizeDoi(input.doi, input.canonicalUrl || input.url),
      ...(input.annotationSourceUrl ? { annotationSourceUrl: normalizeAnnotationSourceUrl(input.annotationSourceUrl) } : {}),
      paragraphText: normalizedBody
    });
    return `sha256:${await digestHex(identity)}`;
  }

  function makeCategorySnapshot(category) {
    if (!isPlainObject(category)) fail('INVALID_CATEGORY_SNAPSHOT');
    const name = normalizeWhitespace(category.name);
    const color = unicodeText(category.color).trim().toUpperCase();
    if (!name || name.length > 200 || !/^#[A-F0-9]{6}$/.test(color)) {
      fail('INVALID_CATEGORY_SNAPSHOT');
    }
    return { name, color };
  }

  function normalizeIdentifier(value, pattern, maxLength, code) {
    const normalized = unicodeText(value).trim();
    if (!normalized || normalized.length > maxLength || !pattern.test(normalized)) fail(code);
    return normalized;
  }

  function normalizeTimestamp(value, code) {
    if (value === undefined || value === null || value === '') return '';
    const timestamp = unicodeText(value).trim();
    if (!Number.isFinite(Date.parse(timestamp))) fail(code);
    return timestamp;
  }

  function normalizeManualAnnotation(input) {
    if (!isPlainObject(input)) fail('INVALID_ANNOTATION');
    const annotationId = normalizeIdentifier(
      input.annotationId,
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
      200,
      'INVALID_ANNOTATION_ID'
    );
    const categoryId = normalizeIdentifier(
      input.categoryId,
      /^[a-z][a-z0-9_]*$/,
      100,
      'INVALID_CATEGORY_ID'
    );
    const quote = rawText(input.quote);
    if (!quote.trim() || quote.length > 20000) fail('INVALID_QUOTE');
    const startOffset = Number(input.startOffset);
    const endOffset = Number(input.endOffset);
    if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) ||
        startOffset < 0 || endOffset <= startOffset || endOffset - startOffset !== quote.length) {
      fail('INVALID_OFFSETS');
    }
    const blockFingerprint = unicodeText(input.blockFingerprint).trim();
    if (!blockFingerprint || blockFingerprint.length > 300) fail('INVALID_BLOCK_FINGERPRINT');
    const note = unicodeText(input.note);
    if (note.length > MAX_NOTE_LENGTH) fail('NOTE_TOO_LONG');
    const status = input.status === undefined ? 'located' : unicodeText(input.status).trim();
    if (!['located', 'unresolved'].includes(status)) fail('INVALID_ANNOTATION_STATUS');
    const snapshot = {
      ...cloneJsonLike(input.categorySnapshot),
      ...makeCategorySnapshot(input.categorySnapshot)
    };

    const pdfAnchor = input.pdfAnchor === undefined || input.pdfAnchor === null
      ? undefined
      : (typeof shared.normalizePdfAnchor === 'function'
        ? shared.normalizePdfAnchor(input.pdfAnchor)
        : fail('PDF_ANNOTATION_SUPPORT_UNAVAILABLE'));

    return {
      ...cloneJsonLike(input),
      annotationId,
      categoryId,
      categorySnapshot: snapshot,
      quote,
      prefix: rawText(input.prefix),
      suffix: rawText(input.suffix),
      sectionTitle: normalizeWhitespace(input.sectionTitle),
      blockFingerprint,
      startOffset,
      endOffset,
      note,
      status,
      createdAt: normalizeTimestamp(input.createdAt, 'INVALID_CREATED_AT'),
      updatedAt: normalizeTimestamp(input.updatedAt, 'INVALID_UPDATED_AT'),
      ...(pdfAnchor ? { pdfAnchor } : {})
    };
  }

  function normalizeDocumentRecord(input) {
    if (!isPlainObject(input)) fail('INVALID_DOCUMENT_RECORD');
    const documentId = unicodeText(input.documentId).trim().toLowerCase();
    if (!/^sha256:[a-f0-9]{64}$/.test(documentId)) fail('INVALID_DOCUMENT_ID');
    if (input.sourceIdentity !== undefined && input.sourceIdentity !== null && input.sourceIdentity !== '' &&
        manualDocumentSourceIdentity(input) !== input.sourceIdentity) fail('INVALID_DOCUMENT_SOURCE_IDENTITY');
    if (input.studyType !== undefined && input.studyType !== null && input.studyType !== '' &&
        !(typeof shared.isStudyType === 'function'
          ? shared.isStudyType(input.studyType) : STUDY_TYPE_IDS.has(input.studyType))) {
      fail('INVALID_STUDY_TYPE');
    }
    if (input.annotations !== undefined && !Array.isArray(input.annotations)) {
      fail('INVALID_ANNOTATIONS');
    }
    const annotations = (input.annotations || []).map(normalizeManualAnnotation);
    if (annotations.length > MAX_ANNOTATIONS_PER_DOCUMENT) fail('ANNOTATION_LIMIT_EXCEEDED');
    const annotationIds = new Set();
    annotations.forEach(item => {
      if (annotationIds.has(item.annotationId)) fail('DUPLICATE_ANNOTATION_ID');
      annotationIds.add(item.annotationId);
    });
    const revision = input.revision === undefined ? 0 : Number(input.revision);
    if (!Number.isSafeInteger(revision) || revision < 0) fail('INVALID_REVISION');

    return {
      ...cloneJsonLike(input),
      schemaVersion: 1,
      documentId,
      title: normalizeWhitespace(input.title),
      canonicalUrl: normalizeCanonicalUrl(input.canonicalUrl || input.url),
      studyType: input.studyType || null,
      annotations,
      revision,
      updatedAt: normalizeTimestamp(input.updatedAt, 'INVALID_UPDATED_AT')
    };
  }

  function commonPrefixLength(expected, actual) {
    const limit = Math.min(expected.length, actual.length);
    let length = 0;
    while (length < limit && expected[length] === actual[length]) length += 1;
    return length;
  }

  function commonSuffixLength(expected, actual) {
    const limit = Math.min(expected.length, actual.length);
    let length = 0;
    while (length < limit &&
           expected[expected.length - length - 1] === actual[actual.length - length - 1]) {
      length += 1;
    }
    return length;
  }

  function blockFingerprint(block) {
    return unicodeText(
      block?.blockFingerprint || block?.fingerprint || block?.blockId || block?.paragraphId
    ).trim();
  }

  function blockId(block) {
    return unicodeText(block?.blockId || block?.paragraphId || blockFingerprint(block)).trim();
  }

  function candidateFor(block, quote, startOffset, prefix, suffix) {
    const text = rawText(block.text);
    const endOffset = startOffset + quote.length;
    return {
      block,
      blockId: blockId(block),
      blockFingerprint: blockFingerprint(block),
      sectionTitle: normalizeWhitespace(block.sectionTitle),
      startOffset,
      endOffset,
      contextScore: commonSuffixLength(prefix, text.slice(0, startOffset)) +
        commonPrefixLength(suffix, text.slice(endOffset))
    };
  }

  function findQuoteCandidates(blocks, quote, prefix, suffix) {
    const candidates = [];
    blocks.forEach(block => {
      const text = rawText(block.text);
      let startOffset = text.indexOf(quote);
      while (startOffset >= 0) {
        candidates.push(candidateFor(block, quote, startOffset, prefix, suffix));
        startOffset = text.indexOf(quote, startOffset + 1);
      }
    });
    return candidates;
  }

  function locatedResult(candidate, matchStage) {
    return {
      status: 'located',
      matchStage,
      blockId: candidate.blockId,
      blockFingerprint: candidate.blockFingerprint,
      sectionTitle: candidate.sectionTitle,
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      contextScore: candidate.contextScore
    };
  }

  function chooseByContext(candidates, matchStage) {
    if (!candidates.length) return null;
    if (candidates.length === 1) return locatedResult(candidates[0], matchStage);
    const ranked = [...candidates].sort((first, second) =>
      second.contextScore - first.contextScore ||
      first.blockId.localeCompare(second.blockId) ||
      first.startOffset - second.startOffset
    );
    if (ranked[0].contextScore === ranked[1].contextScore) {
      return { status: 'unresolved', reason: 'AMBIGUOUS_CONTEXT' };
    }
    return locatedResult(ranked[0], matchStage);
  }

  function locateAnnotationInBlocks(annotation, blocks) {
    const quote = rawText(annotation?.quote);
    const prefix = rawText(annotation?.prefix);
    const suffix = rawText(annotation?.suffix);
    const anchorFingerprint = unicodeText(annotation?.blockFingerprint).trim();
    const startOffset = Number(annotation?.startOffset);
    const endOffset = Number(annotation?.endOffset);
    const validBlocks = (Array.isArray(blocks) ? blocks : [])
      .filter(block => block && typeof block === 'object' && typeof block.text === 'string');
    if (!quote) return { status: 'unresolved', reason: 'INVALID_QUOTE' };

    if (anchorFingerprint && Number.isSafeInteger(startOffset) && Number.isSafeInteger(endOffset)) {
      const exact = validBlocks.filter(block =>
        blockFingerprint(block) === anchorFingerprint &&
        rawText(block.text).slice(startOffset, endOffset) === quote
      ).map(block => candidateFor(block, quote, startOffset, prefix, suffix));
      if (exact.length === 1) return locatedResult(exact[0], 'fingerprint_offset');
    }

    const sectionTitle = normalizeWhitespace(annotation?.sectionTitle).toLocaleLowerCase('en-US');
    if (sectionTitle) {
      const sameSectionBlocks = validBlocks.filter(block =>
        normalizeWhitespace(block.sectionTitle).toLocaleLowerCase('en-US') === sectionTitle
      );
      const sectionCandidates = findQuoteCandidates(sameSectionBlocks, quote, prefix, suffix);
      if (sectionCandidates.length) {
        return chooseByContext(sectionCandidates, 'section_context');
      }
    }

    const documentCandidates = findQuoteCandidates(validBlocks, quote, prefix, suffix);
    if (documentCandidates.length) {
      return chooseByContext(documentCandidates, 'document_context');
    }
    return { status: 'unresolved', reason: 'NOT_FOUND' };
  }

  // A local source key describes independently verified bytes; it never grants
  // access. Only the trusted reader preparation route may mint it. Publisher
  // canonical URLs remain empty when no publisher identity is known.
  function manualDocumentSourceIdentity(value) {
    const own = key => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value || {}, key);
        return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
      } catch (_) { return undefined; }
    };
    const source = own('sourceIdentity');
    if (source !== undefined && source !== null && source !== '') {
      const hash = own('documentHash');
      return typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash) &&
        own('documentId') === `sha256:${hash}` && source === `library-html:sha256:${hash}`
        ? source : '';
    }
    return typeof own('canonicalUrl') === 'string' ? own('canonicalUrl').trim() : '';
  }

  function sameManualAnnotationRefreshIdentity(committedState, response, expectedTabId) {
    const tabId = Number(expectedTabId);
    const documentId = unicodeText(response?.documentId).trim();
    const documentHash = unicodeText(response?.documentHash).trim();
    const canonicalUrl = unicodeText(response?.canonicalUrl).trim();
    const contentWorldNonce = unicodeText(response?.contentWorldNonce).trim();
    const documentEpoch = Number(response?.documentEpoch);
    if (!Number.isSafeInteger(tabId) || !documentId || !documentHash || !manualDocumentSourceIdentity(response) ||
      !/^[a-f0-9]{32,64}$/iu.test(contentWorldNonce) ||
      !Number.isSafeInteger(documentEpoch) || documentEpoch < 1) return false;
    return Number(committedState?.tabId) === tabId &&
      unicodeText(committedState?.documentId).trim() === documentId &&
      unicodeText(committedState?.documentHash).trim() === documentHash &&
      unicodeText(committedState?.canonicalUrl).trim() === canonicalUrl &&
      manualDocumentSourceIdentity(committedState) === manualDocumentSourceIdentity(response) &&
      unicodeText(committedState?.contentWorldNonce).trim() === contentWorldNonce &&
      Number(committedState?.documentEpoch) === documentEpoch;
  }

  function normalizeRefreshTabUrl(value) {
    if (typeof shared.normalizeTabDocumentUrl === 'function') {
      return shared.normalizeTabDocumentUrl(value);
    }
    return unicodeText(value).trim().replace(/#.*$/u, '');
  }

  function manualAnnotationRefreshCommitMode(input = {}) {
    const expectedTabId = Number(input.expectedTabId);
    const capturedTabId = Number(input.capturedTab?.id);
    const currentTabId = Number(input.currentTab?.id);
    const capturedUrl = normalizeRefreshTabUrl(
      input.capturedTab?.url || input.capturedTab?.pendingUrl
    );
    const currentUrl = normalizeRefreshTabUrl(
      input.currentTab?.url || input.currentTab?.pendingUrl
    );
    const response = input.response;
    const liveProof = input.liveProof;
    const responseIdentity = {
      tabId: expectedTabId,
      documentId: unicodeText(response?.documentId).trim(),
      documentHash: unicodeText(response?.documentHash).trim(),
      canonicalUrl: unicodeText(response?.canonicalUrl).trim(),
      sourceIdentity: response?.sourceIdentity,
      contentWorldNonce: unicodeText(response?.contentWorldNonce).trim(),
      documentEpoch: Number(response?.documentEpoch)
    };
    if (!Number.isSafeInteger(expectedTabId) ||
      capturedTabId !== expectedTabId || currentTabId !== expectedTabId ||
      !capturedUrl || capturedUrl !== currentUrl ||
      !sameManualAnnotationRefreshIdentity(responseIdentity, response, expectedTabId) ||
      !sameManualAnnotationRefreshIdentity(responseIdentity, liveProof, expectedTabId)) return null;
    if (input.superseded === true) {
      return sameManualAnnotationRefreshIdentity(
        input.committedState,
        response,
        expectedTabId
      ) ? 'committed' : null;
    }
    return 'response';
  }

  function manualAnnotationEventCommitMode(
    verifiedState,
    event,
    eventTabId,
    activeTabId
  ) {
    const tabId = Number(eventTabId);
    if (!Number.isSafeInteger(tabId) || tabId !== Number(activeTabId)) return 'ignore';
    return sameManualAnnotationRefreshIdentity(
      verifiedState,
      event,
      tabId
    ) ? 'verified' : 'refresh';
  }

  return {
    MAX_NOTE_LENGTH,
    WARNING_ANNOTATIONS_PER_DOCUMENT,
    MAX_ANNOTATIONS_PER_DOCUMENT,
    createDocumentId,
    normalizeAnnotationSourceUrl,
    normalizeManualAnnotation,
    normalizeDocumentRecord,
    locateAnnotationInBlocks,
    makeCategorySnapshot,
    manualDocumentSourceIdentity,
    sameManualAnnotationRefreshIdentity,
    manualAnnotationRefreshCommitMode,
    manualAnnotationEventCommitMode
  };
});


;/* lazy-mermaid.js */
/* Mermaid is downloaded only when a diagram is actually rendered. */
(() => {
 let pending,settings;
 const proxy={initialize(value){settings=value;},run:async(...args)=>(await load()).run(...args),render:async(...args)=>(await load()).render(...args),parse:async(...args)=>(await load()).parse(...args)};
 function load(){
  if(pending)return pending;
  pending=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=new URL('vendor/mermaid/mermaid.min.js',__websiteDemo.base).href;
   script.onload=()=>{try{const actual=globalThis.mermaid;if(actual===proxy)throw Error('Diagram renderer did not initialize');if(settings)actual.initialize(settings);resolve(actual);}catch(error){pending=null;reject(error);}};
   script.onerror=()=>{pending=null;script.remove();reject(Error('Could not load the diagram renderer'));};
   document.head.append(script);
  });return pending;
 }
 globalThis.mermaid=proxy;
})();


;/* native/core/task-telemetry.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clean = (value, limit = 160) => String(value || '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);
  const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(value)) : null;
  const add = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);

  // Only metadata is accepted here. Prompts, responses and document content are
  // deliberately absent from the public task summary.
  function createTaskTelemetry(options = {}) {
    const rows = Array.isArray(options.events) ? options.events : [];
    const models = new Map();
    let input = 0, output = 0, inputKnown = 0, outputKnown = 0, known = 0;
    for (const row of rows) {
      const providerId = clean(row?.providerId, 60);
      const model = clean(row?.model);
      const key = `${providerId}\u0000${model}`;
      if (model && !models.has(key) && models.size < 16) {
        models.set(key, { providerId, model, requests: 0 });
      }
      if (models.has(key)) models.get(key).requests += 1;
      const inCount = count(row?.inputTokens), outCount = count(row?.outputTokens);
      const explicit = row?.usageProvided !== false;
      const hasInput = explicit && row?.inputTokensProvided !== false && inCount !== null;
      const hasOutput = explicit && row?.outputTokensProvided !== false && outCount !== null;
      if (hasInput) { input = add(input, inCount); inputKnown += 1; }
      if (hasOutput) { output = add(output, outCount); outputKnown += 1; }
      if (hasInput && hasOutput) known += 1;
    }
    const requests = rows.length;
    const complete = requests > 0 && known === requests;
    const some = inputKnown > 0 || outputKnown > 0;
    const started = count(options.startedAt), finished = count(options.finishedAt);
    return {
      taskId: clean(options.taskId, 80), label: clean(options.label, 80),
      operationId: clean(options.operationId, 160),
      status: ['success', 'failed', 'cancelled'].includes(options.status) ? options.status : 'success',
      startedAt: started, finishedAt: finished,
      engine: clean(options.engine), models: [...models.values()], requests,
      elapsedMs: started !== null && finished !== null ? Math.max(0, finished - started) : 0,
      inputTokens: inputKnown ? input : null, outputTokens: outputKnown ? output : null,
      totalTokens: inputKnown && outputKnown ? add(input, output) : null,
      usageState: complete ? 'complete' : some ? 'partial' : 'unavailable',
      missingUsageRequests: requests - known, estimated: rows.some(row => row?.estimated === true)
    };
  }

  function formatTaskTelemetry(value = {}) {
    const status = { success: '完成', failed: '失败', cancelled: '取消' }[value.status] || '完成';
    const modelList = Array.isArray(value.models) ? value.models.slice(0, 16)
      .map(row => clean(row?.model)).filter(Boolean) : [];
    const model = [...new Set(modelList)].join('、') || clean(value.engine) || '模型未确认';
    const ms = count(value.elapsedMs) || 0;
    const duration = ms < 60000 ? `${(ms / 1000).toFixed(1)} 秒`
      : `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`;
    const number = n => count(n) === null ? '未提供' : count(n).toLocaleString('en-US');
    const tokens = value.usageState === 'unavailable' ? 'Token：未提供'
      : `Token${value.estimated ? '（估算）' : ''}：输入 ${number(value.inputTokens)} · ` +
        `输出 ${number(value.outputTokens)} · 总计 ${number(value.totalTokens)}` +
        (value.usageState === 'partial' ? '（部分用量）' : '');
    return `${clean(value.label, 80) || '任务'}${status} · 模型：${model} · 耗时 ${duration} · ${tokens}` +
      (count(value.requests) > 0 ? ` · ${count(value.requests)} 次调用` : '');
  }
  function mergeTaskTelemetry(values, options = {}) {
    const rows = (Array.isArray(values) ? values : [values]).filter(v => v && typeof v === 'object');
    if (!rows.length) return null;
    const models = new Map();
    let requests = 0, missing = 0, input = 0, output = 0, hasInput = false, hasOutput = false;
    let elapsed = 0, estimated = false, complete = true;
    for (const row of rows) {
      const n = count(row.requests) ?? 1;
      requests = add(requests, n);
      elapsed = add(elapsed, count(row.elapsedMs) || 0);
      if (n === 0) continue;
      estimated ||= row.estimated === true;
      const unavailable = row.usageState === 'unavailable';
      const i = unavailable ? null : count(row.inputTokens), o = unavailable ? null : count(row.outputTokens);
      if (i !== null) { input = add(input, i); hasInput = true; }
      if (o !== null) { output = add(output, o); hasOutput = true; }
      const isComplete = row.usageState ? row.usageState === 'complete' : i !== null && o !== null;
      complete &&= isComplete;
      missing = add(missing, Math.min(n, count(row.missingUsageRequests) ?? (isComplete ? 0 : n)));
      for (const item of Array.isArray(row.models) ? row.models : []) {
        const model = clean(item?.model), providerId = clean(item?.providerId, 60);
        const key = `${providerId}\u0000${model}`;
        if (!model || (!models.has(key) && models.size >= 16)) continue;
        if (!models.has(key)) models.set(key, { model, providerId, requests: 0 });
        models.get(key).requests = add(models.get(key).requests, count(item.requests) || 0);
      }
    }
    const started = count(options.startedAt), finished = count(options.finishedAt);
    return {
      taskId: clean(options.taskId || rows[0].taskId, 80), label: clean(options.label || rows[0].label, 80),
      operationId: clean(options.operationId || rows[0].operationId, 160),
      status: ['success', 'failed', 'cancelled'].includes(options.status) ? options.status : rows.at(-1).status || 'success',
      startedAt: started, finishedAt: finished,
      engine: clean(options.engine || rows[0].engine), models: [...models.values()], requests,
      elapsedMs: started !== null && finished !== null ? Math.max(0, finished - started) : elapsed,
      inputTokens: hasInput ? input : null, outputTokens: hasOutput ? output : null,
      totalTokens: hasInput && hasOutput ? add(input, output) : null,
      usageState: complete && requests > 0 ? 'complete' : hasInput || hasOutput ? 'partial' : 'unavailable',
      missingUsageRequests: missing, estimated
    };
  }
  return { createTaskTelemetry, mergeTaskTelemetry, formatTaskTelemetry };
});


;/* native/core/sidebar-interactions.js */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.SciLLM=root.SciLLM||{};root.SciLLM.SidebarUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 function viewportPopoverRect({anchor,viewport,width,height,margin=8,gap=6}){
  const left=Number(viewport.left)||0,top=Number(viewport.top)||0;
  const vw=Math.max(0,Number(viewport.width)||0),vh=Math.max(0,Number(viewport.height)||0);
  const w=Math.min(Math.max(0,width),Math.max(0,vw-2*margin));
  const above=clamp(anchor.top-top-gap-margin,0,Math.max(0,vh-2*margin));
  const below=clamp(top+vh-margin-anchor.bottom-gap,0,Math.max(0,vh-2*margin));
  const placement=height<=below||below>=above?'below':'above';
  const maxHeight=Math.max(0,placement==='below'?below:above);
  const h=Math.min(Math.max(0,height),maxHeight);
  return {left:clamp(anchor.right-w,left+margin,left+vw-margin-w),
   top:clamp(placement==='below'?anchor.bottom+gap:anchor.top-gap-h,top+margin,top+vh-margin-h),
   width:w,height:h,maxHeight,placement};
 }
 function positionViewportPanel(panel,anchor,view){
  if(panel.hidden||!anchor?.isConnected)return null;
  const vv=view.visualViewport;
  const viewport={left:vv?.offsetLeft||0,top:vv?.offsetTop||0,width:vv?.width||view.innerWidth,height:vv?.height||view.innerHeight};
  const rect=viewportPopoverRect({anchor:anchor.getBoundingClientRect(),viewport,width:240,height:panel.scrollHeight||panel.getBoundingClientRect().height});
  Object.assign(panel.style,{position:'fixed',right:'auto',bottom:'auto',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',maxHeight:rect.maxHeight+'px',overflowY:'auto'});
  panel.dataset.placement=rect.placement;return rect;
 }
 function createFigureGesture({onLocate,onAnalyze,onInspect,onFeedback,isCurrent=()=>true,setTimer=setTimeout,clearTimer=clearTimeout,singleDelay=500,longDelay=500,immediateLocate=false}){
  let press=null,longTimer=null,singleTimer=null,suppress=false,disposed=false;
  const clear=()=>{clearTimer(longTimer);clearTimer(singleTimer);longTimer=singleTimer=null;};
  const feedback=state=>{if(!disposed)onFeedback?.(state);};
  const fire=(fn,state,event)=>{if(!disposed&&isCurrent()){feedback(state);fn?.(event);}else feedback('idle');};
  function cancel(){if(press||longTimer!==null)suppress=true;press=null;clear();feedback('idle');}
  return {
   pointerDown(event){if(disposed||event.button!==0||event.isPrimary===false)return;clear();suppress=false;
    press={id:event.pointerId,x:event.clientX,y:event.clientY};
    feedback('pressing');
    longTimer=setTimer(()=>{longTimer=null;if(press&&!disposed&&isCurrent()){suppress=true;fire(onInspect,'inspect');}else feedback('idle');},longDelay);
   },
   pointerMove(event){if(press&&event.pointerId===press.id&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>8)cancel();},
   pointerUp(event){if(!press||event.pointerId!==press.id)return;clearTimer(longTimer);longTimer=null;press=null;if(!suppress)feedback('idle');},
   click(event){if(disposed||suppress||!isCurrent())return;clearTimer(singleTimer);singleTimer=null;
    if(event.detail>1)return;
    if(event.detail===0||immediateLocate)fire(onLocate,'locate');
    else {feedback('pending');singleTimer=setTimer(()=>{singleTimer=null;fire(onLocate,'locate');},singleDelay);}
   },
   doubleClick(event){clearTimer(singleTimer);singleTimer=null;if(!suppress)fire(onAnalyze,'analyze',event);},
   keyboard(event){if(event.key!=='Enter'&&event.key!==' ')return false;clear();
    fire(event.altKey?onInspect:event.shiftKey?onAnalyze:onLocate,event.altKey?'inspect':event.shiftKey?'analyze':'locate',event);return true;
   },cancel,
   dispose(){cancel();disposed=true;}
  };
 }
 function bindFigureGesture(button,options){
  const view=button.ownerDocument.defaultView,doc=button.ownerDocument;
  const setTimer=options.setTimer||view.setTimeout.bind(view),clearTimer=options.clearTimer||view.clearTimeout.bind(view);
  let feedbackTimer=null;
  const setFeedback=state=>{
   clearTimer(feedbackTimer);feedbackTimer=null;button.dataset.figureGesture=state;
   options.onFeedback?.(state);
   if(['locate','analyze','inspect'].includes(state))feedbackTimer=setTimer(()=>{feedbackTimer=null;button.dataset.figureGesture='idle';},600);
  };
  button.style.setProperty('--figure-hold-duration',`${options.longDelay??500}ms`);
  const g=createFigureGesture({...options,setTimer,clearTimer,onFeedback:setFeedback}),listeners=[];
  const listen=(target,type,handler,config)=>{target.addEventListener(type,handler,config);listeners.push(()=>target.removeEventListener(type,handler,config));};
  const isolated=fn=>event=>{event.stopPropagation();fn(event);};
  listen(button,'pointerdown',isolated(g.pointerDown));
  listen(button,'pointermove',isolated(g.pointerMove));
  listen(button,'pointerup',isolated(g.pointerUp));
  listen(button,'pointerleave',()=>g.cancel());
  listen(button,'pointercancel',()=>g.cancel());
  listen(button,'click',event=>{event.preventDefault();event.stopPropagation();g.click(event);});
  listen(button,'dblclick',event=>{event.preventDefault();event.stopPropagation();g.doubleClick(event);});
  listen(button,'keydown',event=>{if(event.key==='Escape'){g.cancel();return;}if(g.keyboard(event)){event.preventDefault();event.stopPropagation();}});
  listen(doc,'keydown',event=>{if(event.key==='Escape')g.cancel();});
  listen(doc,'scroll',()=>g.cancel(),true);listen(view,'blur',()=>g.cancel());
  return ()=>{g.dispose();clearTimer(feedbackTimer);feedbackTimer=null;delete button.dataset.figureGesture;listeners.forEach(fn=>fn());};
 }
 function isSidebarTaskGenerating(task,{pendingStop=false}={}){
  if(!task||task.status!=='running'||task.terminal===true||task.cancelRequested||pendingStop||task.backendModule==='highlight-regex')return false;
  return ![task.phase,task.stage].some(value=>['stopping','outcome_unknown','pending-receipt','awaiting_ack','awaiting-ack','saving','validating','backoff'].includes(value));
 }
 const labels={preparing:'准备中',running:'执行中',retrying:'自动重试',backoff:'等待重试',validating:'核验中',saving:'保存中',stopping:'正在停止',outcome_unknown:'结果待确认',stopped:'已停止',partial:'部分完成',failed:'失败',completed:'已完成',saveFailed:'保存失败',blocked:'需处理'};
 function projectSidebarTask(input){
  if(!input||!['navigation','highlights','figures','note'].includes(input.module)||!input.operationId||!input.documentId||
   !Number.isSafeInteger(input.epoch)||input.epoch<0||!Number.isSafeInteger(input.workspaceLifecycle)||input.workspaceLifecycle<0||
   !Number.isSafeInteger(input.eventSequence)||input.eventSequence<0)return null;
  const total=Math.max(0,Number(input.totalUnits)||0),done=clamp(Number(input.completedUnits)||0,0,total);
  const complete=input.status==='completed'&&input.terminal===true&&!input.cancelRequested;
  const percent=complete?100:total?Math.min(99,Math.floor(done/total*100)):null;
  return {...input,totalUnits:total,completedUnits:done,percent,
   label:input.cancelRequested&&['outcome_unknown','pending-receipt'].includes(input.status)?'停止确认中':labels[input.status]||'等待状态',
   busy:input.terminal!==true||['stopping','outcome_unknown','pending-receipt'].includes(input.status)};
 }
 function createSidebarTaskStore(){
  const states=new Map(),backendStates=new Map();
  return {accept(input){const next=projectSidebarTask(input);if(!next)return false;
   const key=next.documentId+'|'+next.module,backendKey=key+'|'+(next.backendModule||next.module);
   const latest=states.get(key),old=backendStates.get(backendKey);
   if(latest&&next.workspaceLifecycle<latest.workspaceLifecycle)return false;
   if(old){
    if(next.workspaceLifecycle<old.workspaceLifecycle)return false;
    if(next.workspaceLifecycle===old.workspaceLifecycle){
     if(next.epoch<old.epoch||next.epoch===old.epoch&&next.operationId!==old.operationId)return false;
     if(next.operationId===old.operationId&&(next.eventSequence<=old.eventSequence||old.terminal===true&&next.status!==old.status&&old.status!=='outcome_unknown'))return false;
    }
   }backendStates.set(backendKey,next);states.set(key,next);return true;
  },retireExact(expected,receipt){
   const key=expected?.documentId+'|'+expected?.module,current=states.get(key),task=receipt?.task;
   if(!current||receipt?.receiptOnly!==true||task?.terminal!==true||task.module!=='figures'||task.documentId!==expected.contentDocumentIdentity||current.terminal||
    !['operationId','epoch','workspaceLifecycle'].every(field=>current[field]===expected[field]&&task[field]===expected[field])||
    current.contentDocumentIdentity!==expected.contentDocumentIdentity||current.contentDocumentIdentity!==receipt.contentDocumentIdentity||
    receipt.navigationIdentity!==expected.navigationIdentity||
    !['completed','partial','failed','stopped'].includes(task.status))return false;
   const retired={...projectSidebarTask({...current,status:task.status,terminal:true,cancelRequested:task.cancelRequested===true,
    completedUnits:task.completedUnits,totalUnits:task.totalUnits}),retired:true,receiptOnly:true,
    cancellationOrigin:receipt.cancellationOrigin||'',label:receipt.cancellationOrigin==='article-source-changed'?'正文已更新':task.status==='completed'?'已完成':'已停止'};
   states.set(key,retired);backendStates.set(key+'|'+(current.backendModule||current.module),retired);return true;
  },get:(documentId,module)=>states.get(documentId+'|'+module)||null};
 }
 function parseArtworkPages(value,pageCount){
  if(!Number.isSafeInteger(pageCount)||pageCount<1)throw new Error('当前 PDF 页数不可用，请重新绑定文献。');
  const pages=[];
  for(const part of String(value||'').trim().split(/[,，\s]+/u).filter(Boolean)){
   const match=/^(\d+)(?:[-–](\d+))?$/u.exec(part);
   if(!match)throw new Error('请使用物理页码或范围，例如 5-6。');
   const start=Number(match[1]),end=Number(match[2]||match[1]);
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>pageCount||end-start>3)throw new Error(`物理页码须在 1–${pageCount} 内，最多 4 页。`);
   for(let page=start;page<=end;page++)pages.push(page);
  }
  if(!pages.length||pages.length>4||new Set(pages).size!==pages.length)throw new Error('请选择 1–4 个不重复的物理页码。');
  return pages;
 }
 function translationStatusLabel(state={}){
  const n=key=>Math.max(0,Number(state[key])||0);
  const progress=n('total')?` · 已保存 ${n('completed')}/${n('total')}`:'';
  const attempts=n('attempts')?` · 尝试 ${n('attempts')} / 重试 ${n('retries')}`:'';
  let label;
  if(n('stopPending')||n('stopUnknown')||['stopping','pending-receipt'].includes(state.phase))label='停止确认中（仅查询回执）';
  else if(n('saveFailed')||state.phase==='saveFailed')label='译文保存失败';
  else if(n('blocked')||state.phase==='blocked')label='翻译已阻塞，请检查模型配置/额度';
  else if(n('unknown'))label='等待原请求回执，不重复推理';
  else if(n('saving')||state.phase==='saving')label='正在保存译文';
  else if(n('retrying')||state.phase==='retrying')label='翻译自动重试中';
  else if(state.enabled===false&&n('unfinished'))label=`翻译已停止 · 未完成 ${n('unfinished')}，点击继续`;
  else if(state.phase==='complete')label='当前范围译文已全部保存；点击停止，译文保留';
  else if(state.enabled)label='翻译进行中；点击停止，保留已保存译文';
  else label='开启/继续全文翻译，复用已保存译文';
  return label+progress+attempts;
 }
 return {viewportPopoverRect,positionViewportPanel,createFigureGesture,bindFigureGesture,isSidebarTaskGenerating,projectSidebarTask,createSidebarTaskStore,translationStatusLabel,parseArtworkPages};
});


;/* native/core/sidebar-sort.js */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.SciLLM=root.SciLLM||{};root.SciLLM.SidebarSort=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function figureDropIds(ids,movingId,rows,y){
  if(!Array.isArray(ids)||ids.length>128||new Set(ids).size!==ids.length||!ids.includes(movingId))return null;
  const others=ids.filter(id=>id!==movingId),bounds=new Map(rows.map(row=>[row.id,row]));
  let insertion=others.findIndex(id=>{const row=bounds.get(id);return row&&y<(row.top+row.bottom)/2;});
  if(insertion<0)insertion=others.length;
  others.splice(insertion,0,movingId);return others;
 }
 function createFigureSortSession(options){
  const o=options||{},set=o.setTimer||setTimeout,clear=o.clearTimer||clearTimeout;
  let phase='idle',record=null,timer=null,generation=0;
  const current=()=>record&&o.isCurrent?.(record.context)!==false;
  function reset(){clear(timer);timer=null;record=null;phase='idle';o.onBusy?.(false);}
  function cancel(force=false){
   if(phase==='idle'||phase==='saving'&&!force)return false;
   generation++;clear(timer);timer=null;o.onRollback?.();reset();return true;
  }
  return {state:()=>phase,cancel,
   down(event){if(phase!=='idle'||event.button!==0||event.isPrimary===false)return false;
    record={pointerId:event.pointerId,x:event.clientX,y:event.clientY,context:o.captureContext?.()};phase='holding';
    timer=set(()=>{timer=null;if(!current()){cancel();return;}
     try{if(o.onStart?.(record)===false){cancel();return;}phase='dragging';o.onBusy?.(true);}catch(error){o.onError?.(error);cancel();}},400);return true;
   },
   move(event){if(!record||event.pointerId!==record.pointerId)return false;
    if(!current()){cancel(true);return false;}
    if(phase==='holding'&&Math.hypot(event.clientX-record.x,event.clientY-record.y)>6){cancel();return false;}
    if(phase==='dragging'){record.order=o.getOrder?.(event);o.onPreview?.(event,record.order);return true;}return false;
   },
   async up(event){if(!record||event.pointerId!==record.pointerId)return false;
    if(phase==='holding'){reset();return false;}if(phase!=='dragging')return false;
    if(!current()){cancel();return false;}
    const order=o.getOrder?.(event)||record.order;if(!order){cancel();return false;}
    const token=generation,context=record.context;phase='saving';o.onSaving?.();
    try{const ack=await o.persist(order,context);
     if(token!==generation)return false;
     if(ack?.success!==true||!ack.draft||ack.stale)throw new Error(ack?.code||'展示顺序保存未确认');
     o.onCommit?.(ack,order);return true;
    }catch(error){if(token===generation){o.onRollback?.();o.onError?.(error);}return false;
    }finally{if(token===generation)reset();}
   }
  };
 }
 function bindFigureSort({summary,card,container,ids,captureContext,isCurrent,persist,setEditing,onError,onActive}){
  const doc=card.ownerDocument,view=doc.defaultView;
  const scroll=container.closest('[data-workspace-view]')||container;
  const reduced=view.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  const duration=reduced?0:180;
  let placeholder=null,originalNext=null,originalStyles=null,offsetX=0,offsetY=0,pointer=null,raf=null,lastEvent=null,suppress=false,disposed=false,keyboardSaving=false;
  const listeners=[],styles=new Map();
  const cards=()=>[...container.querySelectorAll(':scope > .workspace-figure-card[data-figure-id]')].filter(item=>item!==card);
  const listen=(target,type,fn,opts)=>{target.addEventListener(type,fn,opts);listeners.push(()=>target.removeEventListener(type,fn,opts));};
  const bounds=()=>cards().map(item=>({id:item.dataset.figureId,...item.getBoundingClientRect().toJSON?.(),top:item.getBoundingClientRect().top,bottom:item.getBoundingClientRect().bottom}));
  function cleanup(commit=false){
   if(raf!==null)view.cancelAnimationFrame(raf);raf=null;
   if(placeholder){
    if(commit)container.insertBefore(card,placeholder);
    else if(originalNext?.parentNode===container)container.insertBefore(card,originalNext);
    placeholder.remove();placeholder=null;
   }
   if(originalStyles!==null){card.setAttribute('style',originalStyles);originalStyles=null;}
   card.classList.remove('is-display-sorting');card.removeAttribute('aria-grabbed');card.removeAttribute('aria-busy');
   for(const [item,style]of styles){item.setAttribute('style',style);item.classList.remove('is-sort-neighbor');}styles.clear();
   if(pointer!==null){try{summary.releasePointerCapture(pointer);}catch{}pointer=null;}
   // Keep suppression through the browser's synthesized click after pointerup.
   view.setTimeout(()=>{suppress=false;},0);
  }
  function flip(before){
   for(const item of cards()){
    const old=before.get(item),next=item.getBoundingClientRect();
    item.style.transition='none';item.style.transform=`translateY(${old?old.top-next.top:0}px) scale(.98)`;
    view.requestAnimationFrame(()=>{if(disposed||!placeholder)return;item.style.transition=`transform ${duration}ms ease`;item.style.transform='scale(.98)';});
   }
  }
  function preview(event,order){
   lastEvent=event;
   if(!placeholder||!order)return;
   card.style.left=(event.clientX-offsetX)+'px';card.style.top=(event.clientY-offsetY)+'px';
   const insertion=order.indexOf(card.dataset.figureId),others=cards();
   const nextId=order[insertion+1],next=others.find(item=>item.dataset.figureId===nextId)||null;
   if(placeholder.nextElementSibling!==next){
    const before=new Map(others.map(item=>[item,item.getBoundingClientRect()]));
    container.insertBefore(placeholder,next);flip(before);
   }
  }
  const session=createFigureSortSession({captureContext,isCurrent,
   onStart(record){if(disposed||!card.isConnected)return false;
    onActive?.(()=>session.cancel(true));originalNext=card.nextSibling;originalStyles=card.getAttribute('style')||'';
    const rect=card.getBoundingClientRect();offsetX=record.x-rect.left;offsetY=record.y-rect.top;
    placeholder=doc.createElement('div');placeholder.className='workspace-figure-sort-placeholder';
    placeholder.style.height=rect.height+'px';placeholder.style.boxSizing='border-box';
    const computed=view.getComputedStyle(card);placeholder.style.marginTop=computed.marginTop;placeholder.style.marginBottom=computed.marginBottom;
    container.insertBefore(placeholder,card);suppress=true;pointer=record.pointerId;
    try{summary.setPointerCapture(pointer);}catch{}
    for(const item of cards()){styles.set(item,item.getAttribute('style')||'');item.classList.add('is-sort-neighbor');item.style.transition=`transform ${duration}ms ease`;item.style.transform='scale(.98)';}
    card.classList.add('is-display-sorting');card.setAttribute('aria-grabbed','true');
    Object.assign(card.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',maxHeight:rect.height+'px',overflow:'hidden',margin:'0',zIndex:'1050',transform:'scale(1.03)',transition:`transform ${duration}ms ease`,pointerEvents:'none'});
    lastEvent={clientX:record.x,clientY:record.y,pointerId:record.pointerId};
    const tick=()=>{
     if(session.state()!=='dragging'||!placeholder){raf=null;return;}
     const viewport=scroll.getBoundingClientRect(),y=lastEvent?.clientY;
     const velocity=y<viewport.top+44?-Math.min(12,(viewport.top+44-y)/3):y>viewport.bottom-44?Math.min(12,(y-viewport.bottom+44)/3):0;
     if(velocity){scroll.scrollTop+=velocity;session.move(lastEvent);}
     raf=view.requestAnimationFrame(tick);
    };raf=view.requestAnimationFrame(tick);return true;
   },
   getOrder:event=>figureDropIds(ids,card.dataset.figureId,bounds(),event.clientY),onPreview:preview,
   onSaving(){card.setAttribute('aria-busy','true');},persist,
   onCommit(){cleanup(true);},onRollback(){cleanup(false);},onBusy:value=>setEditing?.(value),onError
  });
  summary.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');
  summary.title='在 Fig 色块以外长按 0.4 秒拖动排序；Alt+↑/↓ 调整展示位置';
  listen(summary,'pointerdown',event=>{
   if(event.ctrlKey||event.metaKey||event.shiftKey||event.target.closest('button,input,select,textarea,a,[contenteditable="true"]'))return;
   session.down(event);
  });
  listen(summary,'pointermove',event=>{if(session.move(event))event.preventDefault();});
  listen(summary,'pointerup',event=>{if(session.state()==='dragging')event.preventDefault();void session.up(event);});
  listen(summary,'pointercancel',()=>session.cancel());
  listen(summary,'pointerleave',()=>{if(session.state()==='holding')session.cancel();});
  listen(summary,'lostpointercapture',()=>session.cancel());
  listen(summary,'contextmenu',event=>{if(session.state()!=='idle'){event.preventDefault();session.cancel();}});
  listen(summary,'click',event=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();}},true);
  listen(summary,'keydown',event=>{
   if(event.target!==summary||!event.altKey||event.ctrlKey||event.metaKey||!['ArrowUp','ArrowDown'].includes(event.key)||session.state()!=='idle'||keyboardSaving)return;
   event.preventDefault();const index=ids.indexOf(card.dataset.figureId),target=index+(event.key==='ArrowUp'?-1:1);if(target<0||target>=ids.length)return;
   const order=ids.slice();[order[index],order[target]]=[order[target],order[index]];
   keyboardSaving=true;setEditing?.(true);void persist(order,captureContext()).then(ack=>{if(!ack?.success||!ack.draft||ack.stale)throw new Error('排序保存未确认');}).catch(onError).finally(()=>{keyboardSaving=false;setEditing?.(false);});
  });
  listen(doc,'keydown',event=>{if(event.key==='Escape')session.cancel();});
  listen(view,'blur',()=>session.cancel());
  return ()=>{if(disposed)return;disposed=true;session.cancel(true);cleanup();listeners.forEach(fn=>fn());};
 }
 return {figureDropIds,createFigureSortSession,bindFigureSort};
});


;/* native/vendor/semantic-icons-r42/resources.js */
/* Complete original icon geometry. Pinned packages, licenses, SHA512/SHA256: per-family vendor PROVENANCE.json. */
window.SemanticResources={"lucide":{"list-tree":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"M8 5h13"}],["path",{"d":"M13 12h8"}],["path",{"d":"M13 19h8"}],["path",{"d":"M3 10a2 2 0 0 0 2 2h3"}],["path",{"d":"M3 5v12a2 2 0 0 0 2 2h3"}]]},"highlighter":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"m9 11-6 6v3h9l3-3"}],["path",{"d":"m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"}]]},"chart-no-axes-combined":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"M12 16v5"}],["path",{"d":"M16 14.639V21"}],["path",{"d":"M20 10.656V21"}],["path",{"d":"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"}],["path",{"d":"M4 18.463V21"}],["path",{"d":"M8 14.656V21"}]]},"chart-no-axes-column":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"M5 21v-6"}],["path",{"d":"M12 21V3"}],["path",{"d":"M19 21V9"}]]},"expand":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"m15 15 6 6"}],["path",{"d":"m15 9 6-6"}],["path",{"d":"M21 16v5h-5"}],["path",{"d":"M21 8V3h-5"}],["path",{"d":"M3 16v5h5"}],["path",{"d":"m3 21 6-6"}],["path",{"d":"M3 8V3h5"}],["path",{"d":"M9 9 3 3"}]]},"message-circle-more":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}],["path",{"d":"M8 12h.01"}],["path",{"d":"M12 12h.01"}],["path",{"d":"M16 12h.01"}]]},"message-square-more":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"}],["path",{"d":"M12 11h.01"}],["path",{"d":"M16 11h.01"}],["path",{"d":"M8 11h.01"}]]},"notebook-text":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"M2 6h4"}],["path",{"d":"M2 10h4"}],["path",{"d":"M2 14h4"}],["path",{"d":"M2 18h4"}],["rect",{"width":"16","height":"20","x":"4","y":"2","rx":"2"}],["path",{"d":"M9.5 8h5"}],["path",{"d":"M9.5 12H16"}],["path",{"d":"M9.5 16H14"}]]},"check":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"M20 6 9 17l-5-5"}]]},"x":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]]}},"tabler":{"list-details":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"stroke":"none","d":"M0 0h24v24H0z","fill":"none"}],["path",{"d":"M13 5h8"}],["path",{"d":"M13 9h5"}],["path",{"d":"M13 15h8"}],["path",{"d":"M13 19h5"}],["path",{"d":"M3 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"}],["path",{"d":"M3 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"}]]},"highlight":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"stroke":"none","d":"M0 0h24v24H0z","fill":"none"}],["path",{"d":"M3 19h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"}],["path",{"d":"M12.5 5.5l4 4"}],["path",{"d":"M4.5 13.5l4 4"}],["path",{"d":"M21 15v4h-8l4 -4l4 0"}]]},"photo-scan":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"stroke":"none","d":"M0 0h24v24H0z","fill":"none"}],["path",{"d":"M15 8h.01"}],["path",{"d":"M6 13l2.644 -2.644a1.21 1.21 0 0 1 1.712 0l3.644 3.644"}],["path",{"d":"M13 13l1.644 -1.644a1.21 1.21 0 0 1 1.712 0l1.644 1.644"}],["path",{"d":"M3 7v-2a2 2 0 0 1 2 -2h2"}],["path",{"d":"M3 17v2a2 2 0 0 0 2 2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M17 21h2a2 2 0 0 0 2 -2v-2"}]]},"message-2":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"stroke":"none","d":"M0 0h24v24H0z","fill":"none"}],["path",{"d":"M8 9h8"}],["path",{"d":"M8 13h6"}],["path",{"d":"M9 18h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-3l-3 3l-3 -3"}]]},"message-chatbot":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"stroke":"none","d":"M0 0h24v24H0z","fill":"none"}],["path",{"d":"M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12"}],["path",{"d":"M9.5 9h.01"}],["path",{"d":"M14.5 9h.01"}],["path",{"d":"M9.5 13a3.5 3.5 0 0 0 5 0"}]]},"notes":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"stroke":"none","d":"M0 0h24v24H0z","fill":"none"}],["path",{"d":"M5 5a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -14"}],["path",{"d":"M9 7l6 0"}],["path",{"d":"M9 11l6 0"}],["path",{"d":"M9 15l4 0"}]]},"notebook":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"stroke":"none","d":"M0 0h24v24H0z","fill":"none"}],["path",{"d":"M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-11a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1m3 0v18"}],["path",{"d":"M13 8l2 0"}],["path",{"d":"M13 12l2 0"}]]},"book-2":{"viewBox":"0 0 24 24","attrs":{"fill":"none","stroke":"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},"nodes":[["path",{"stroke":"none","d":"M0 0h24v24H0z","fill":"none"}],["path",{"d":"M19 4v16h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12"}],["path",{"d":"M19 16h-12a2 2 0 0 0 -2 2"}],["path",{"d":"M9 8h6"}]]}},"phosphor":{"regular/list-dashes":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M88,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H96A8,8,0,0,1,88,64Zm128,56H96a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm0,64H96a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16ZM56,56H40a8,8,0,0,0,0,16H56a8,8,0,0,0,0-16Zm0,64H40a8,8,0,0,0,0,16H56a8,8,0,0,0,0-16Zm0,64H40a8,8,0,0,0,0,16H56a8,8,0,0,0,0-16Z"}]]},"duotone/list-dashes":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M216,64V192H96V64Z","opacity":"0.2"}],["path",{"d":"M88,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H96A8,8,0,0,1,88,64Zm128,56H96a8,8,0,1,0,0,16H216a8,8,0,0,0,0-16Zm0,64H96a8,8,0,1,0,0,16H216a8,8,0,0,0,0-16ZM56,56H40a8,8,0,0,0,0,16H56a8,8,0,0,0,0-16Zm0,64H40a8,8,0,1,0,0,16H56a8,8,0,0,0,0-16Zm0,64H40a8,8,0,1,0,0,16H56a8,8,0,0,0,0-16Z"}]]},"regular/highlighter":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M253.66,106.34a8,8,0,0,0-11.32,0L192,156.69,107.31,72l50.35-50.34a8,8,0,1,0-11.32-11.32L96,60.69A16,16,0,0,0,93.18,79.5L72,100.69a16,16,0,0,0,0,22.62L76.69,128,18.34,186.34a8,8,0,0,0,3.13,13.25l72,24A7.88,7.88,0,0,0,96,224a8,8,0,0,0,5.66-2.34L136,187.31l4.69,4.69a16,16,0,0,0,22.62,0l21.19-21.18A16,16,0,0,0,203.31,168l50.35-50.34A8,8,0,0,0,253.66,106.34ZM93.84,206.85l-55-18.35L88,139.31,124.69,176ZM152,180.69,83.31,112,104,91.31,172.69,160Z"}]]},"duotone/highlighter":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M136,176,96,216,24,192l64-64Z","opacity":"0.2"}],["path",{"d":"M253.66,106.34a8,8,0,0,0-11.32,0L192,156.69,109.66,74.34h0L107.31,72l50.35-50.34a8,8,0,1,0-11.32-11.32L96,60.69A16,16,0,0,0,93.18,79.5L72,100.69a16,16,0,0,0,0,22.62L76.69,128,18.34,186.34a8,8,0,0,0,3.13,13.25l72,24A7.88,7.88,0,0,0,96,224a8,8,0,0,0,5.66-2.34L136,187.31l4.69,4.69a16,16,0,0,0,22.62,0l21.18-21.18A16,16,0,0,0,203.31,168l50.35-50.34A8,8,0,0,0,253.66,106.34ZM93.84,206.85l-55-18.35L88,139.31,124.69,176ZM152,180.69l-10.34-10.35h0l-48-48h0L83.31,112,104,91.31,172.69,160Z"}]]},"regular/highlighter-circle":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M201.54,54.46A104,104,0,0,0,54.46,201.54,104,104,0,0,0,201.54,54.46ZM96,210V152h64v58a88.33,88.33,0,0,1-64,0Zm48-74H112V100.94l32-16Zm46.22,54.22A88.09,88.09,0,0,1,176,201.77V152a16,16,0,0,0-16-16V72a8,8,0,0,0-11.58-7.16l-48,24A8,8,0,0,0,96,96v40a16,16,0,0,0-16,16v49.77a88,88,0,1,1,110.22-11.55Z"}]]},"duotone/highlighter-circle":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M195.88,195.88A95.7,95.7,0,0,1,168,215.29V152a8,8,0,0,0-8-8h-8V72L104,96v48H96a8,8,0,0,0-8,8v63.29a96,96,0,1,1,107.88-19.41Z","opacity":"0.2"}],["path",{"d":"M201.54,54.46A104,104,0,0,0,54.46,201.54,104,104,0,0,0,201.54,54.46ZM96,210V152h64v58a88.33,88.33,0,0,1-64,0Zm48-74H112V100.94l32-16Zm46.22,54.22A88.09,88.09,0,0,1,176,201.77V152a16,16,0,0,0-16-16V72a8,8,0,0,0-11.58-7.16l-48,24A8,8,0,0,0,96,96v40a16,16,0,0,0-16,16v49.77a88,88,0,1,1,110.22-11.55Z"}]]},"bold/highlighter-circle":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M204.37,51.59A108,108,0,1,0,236,128,108.11,108.11,0,0,0,204.37,51.59ZM140,136H116V111.39l24-12Zm-40,71.25V160h56v47.25a84.73,84.73,0,0,1-56,0Zm87.4-19.84a84.53,84.53,0,0,1-7.4,6.55V156a20,20,0,0,0-16-19.6V80a12,12,0,0,0-17.37-10.73l-48,24A12,12,0,0,0,92,104v32.41A20,20,0,0,0,76,156v38a84.53,84.53,0,0,1-7.4-6.55,84,84,0,1,1,118.8,0Z"}]]},"regular/image-square":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM48,48H208v77.38l-24.69-24.7a16,16,0,0,0-22.62,0L53.37,208H48ZM208,208H76l96-96,36,36v60ZM96,120A24,24,0,1,0,72,96,24,24,0,0,0,96,120Zm0-32a8,8,0,1,1-8,8A8,8,0,0,1,96,88Z"}]]},"duotone/image-square":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M208,40H48a8,8,0,0,0-8,8V208a8,8,0,0,0,8,8h8.69L166.34,106.34a8,8,0,0,1,11.32,0L216,144.69V48A8,8,0,0,0,208,40ZM96,112a16,16,0,1,1,16-16A16,16,0,0,1,96,112Z","opacity":"0.2"}],["path",{"d":"M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM48,48H208v77.38l-24.69-24.7a16,16,0,0,0-22.62,0L53.37,208H48ZM208,208H76l96-96,36,36v60ZM96,120A24,24,0,1,0,72,96,24,24,0,0,0,96,120Zm0-32a8,8,0,1,1-8,8A8,8,0,0,1,96,88Z"}]]},"regular/images-square":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M208,32H80A16,16,0,0,0,64,48V64H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V192h16a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM80,48H208v69.38l-16.7-16.7a16,16,0,0,0-22.62,0L93.37,176H80Zm96,160H48V80H64v96a16,16,0,0,0,16,16h96Zm32-32H116l64-64,28,28v36Zm-88-64A24,24,0,1,0,96,88,24,24,0,0,0,120,112Zm0-32a8,8,0,1,1-8,8A8,8,0,0,1,120,80Z"}]]},"duotone/images-square":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M208,40H80a8,8,0,0,0-8,8V176a8,8,0,0,0,8,8H96.69l77.65-77.66a8,8,0,0,1,11.32,0L216,136.69V48A8,8,0,0,0,208,40Zm-88,64a16,16,0,1,1,16-16A16,16,0,0,1,120,104Z","opacity":"0.2"}],["path",{"d":"M208,32H80A16,16,0,0,0,64,48V64H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V192h16a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM80,48H208v69.38l-16.7-16.7a16,16,0,0,0-22.62,0L93.37,176H80Zm96,160H48V80H64v96a16,16,0,0,0,16,16h96Zm32-32H116l64-64,28,28v36Zm-88-64A24,24,0,1,0,96,88,24,24,0,0,0,120,112Zm0-32a8,8,0,1,1-8,8A8,8,0,0,1,120,80Z"}]]},"regular/chat-circle-dots":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128ZM84,116a12,12,0,1,0,12,12A12,12,0,0,0,84,116Zm88,0a12,12,0,1,0,12,12A12,12,0,0,0,172,116Zm60,12A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Zm-16,0A88,88,0,1,0,51.81,172.06a8,8,0,0,1,.66,6.54L40,216,77.4,203.53a7.85,7.85,0,0,1,2.53-.42,8,8,0,0,1,4,1.08A88,88,0,0,0,216,128Z"}]]},"duotone/chat-circle-dots":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M224,128A96,96,0,0,1,79.93,211.11h0L42.54,223.58a8,8,0,0,1-10.12-10.12l12.47-37.39h0A96,96,0,1,1,224,128Z","opacity":"0.2"}],["path",{"d":"M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-4-1.08,7.85,7.85,0,0,0-2.53.42L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Zm12-88a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm-44,0a12,12,0,1,1-12-12A12,12,0,0,1,96,128Zm88,0a12,12,0,1,1-12-12A12,12,0,0,1,184,128Z"}]]},"regular/chat-dots":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M116,128a12,12,0,1,1,12,12A12,12,0,0,1,116,128ZM84,140a12,12,0,1,0-12-12A12,12,0,0,0,84,140Zm88,0a12,12,0,1,0-12-12A12,12,0,0,0,172,140Zm60-76V192a16,16,0,0,1-16,16H83l-32.6,28.16-.09.07A15.89,15.89,0,0,1,40,240a16.13,16.13,0,0,1-6.8-1.52A15.85,15.85,0,0,1,24,224V64A16,16,0,0,1,40,48H216A16,16,0,0,1,232,64ZM40,224h0ZM216,64H40V224l34.77-30A8,8,0,0,1,80,192H216Z"}]]},"duotone/chat-dots":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M224,64V192a8,8,0,0,1-8,8H80L45.15,230.11A8,8,0,0,1,32,224V64a8,8,0,0,1,8-8H216A8,8,0,0,1,224,64Z","opacity":"0.2"}],["path",{"d":"M116,128a12,12,0,1,1,12,12A12,12,0,0,1,116,128ZM84,140a12,12,0,1,0-12-12A12,12,0,0,0,84,140Zm88,0a12,12,0,1,0-12-12A12,12,0,0,0,172,140Zm60-76V192a16,16,0,0,1-16,16H83l-32.6,28.16-.09.07A15.89,15.89,0,0,1,40,240a16.13,16.13,0,0,1-6.8-1.52A15.85,15.85,0,0,1,24,224V64A16,16,0,0,1,40,48H216A16,16,0,0,1,232,64ZM40,224h0ZM216,64H40V224l34.77-30A8,8,0,0,1,80,192H216Z"}]]},"regular/notebook":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M184,112a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h64A8,8,0,0,1,184,112Zm-8,24H112a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm48-88V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM48,208H72V48H48Zm160,0V48H88V208H208Z"}]]},"duotone/notebook":{"viewBox":"0 0 256 256","attrs":{"fill":"currentColor"},"nodes":[["path",{"d":"M80,40V216H48a8,8,0,0,1-8-8V48a8,8,0,0,1,8-8Z","opacity":"0.2"}],["path",{"d":"M184,112a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h64A8,8,0,0,1,184,112Zm-8,24H112a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm48-88V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM48,208H72V48H48Zm160,0V48H88V208H208Z"}]]}},"fluent":{"highlight-24-regular":{"viewBox":"0 0 24 24","attrs":{"fill":"none"},"nodes":[["path",{"d":"M20.2586 2.00391C20.6383 2.00425 20.9518 2.28669 21.0011 2.65281L21.0079 2.75458L21.0038 7.25229C21.0009 8.40861 20.1271 9.36025 19.0029 9.48624L19.0025 11.746C19.0025 12.9369 18.0773 13.9117 16.9065 13.9908L16.7525 13.996L16.501 13.9959L16.5018 16.7876C16.5018 17.6026 16.0617 18.3489 15.3601 18.7458L15.2058 18.8254L8.57108 21.9317C8.10485 22.1499 7.57412 21.8446 7.5096 21.3531L7.50307 21.2524L7.503 13.9959L7.25 13.996C6.05914 13.996 5.08436 13.0708 5.00519 11.9001L5 11.746L5.00044 9.48671C3.92882 9.36846 3.08392 8.49764 3.00589 7.4144L3 7.25039V2.75391C3 2.33969 3.33579 2.00391 3.75 2.00391C4.1297 2.00391 4.44349 2.28606 4.49315 2.65214L4.5 2.75391V7.25039C4.5 7.63009 4.78215 7.94388 5.14823 7.99355L5.25 8.00039L18.7513 8.00039C19.1316 7.99977 19.4461 7.71712 19.4967 7.35138L19.5038 7.24972L19.5079 2.75323C19.5083 2.33902 19.8444 2.00353 20.2586 2.00391ZM15.001 13.9959H9.003L9.00307 20.0731L14.5698 17.4669C14.8004 17.3589 14.9582 17.1427 14.994 16.8953L15.0018 16.7876L15.001 13.9959ZM17.502 9.49991H6.5V11.746C6.5 12.1257 6.78215 12.4395 7.14823 12.4892L7.25 12.496H16.7525C17.1322 12.496 17.446 12.2139 17.4956 11.8478L17.5025 11.746L17.502 9.49991Z","fill":"#212121"}]]},"highlight-24-filled":{"viewBox":"0 0 24 24","attrs":{"fill":"none"},"nodes":[["path",{"d":"M5.25 2C4.00736 2 3 3.00736 3 4.25V7.25C3 8.49264 4.00736 9.5 5.25 9.5H18.75C19.9926 9.5 21 8.49264 21 7.25V4.25C21 3.00736 19.9926 2 18.75 2H5.25Z","fill":"#212121"}],["path",{"d":"M5 11.75V11H19V11.75C19 12.9926 17.9926 14 16.75 14H7.25C6.00736 14 5 12.9926 5 11.75Z","fill":"#212121"}],["path",{"d":"M7.50294 15.5H16.5013L16.5017 16.7881C16.5017 17.6031 16.0616 18.3494 15.36 18.7463L15.2057 18.8259L8.57101 21.9321C8.10478 22.1504 7.57405 21.8451 7.50953 21.3536L7.503 21.2529L7.50294 15.5Z","fill":"#212121"}]]}},"mdi":{"marker":{"viewBox":"0 0 24 24","attrs":{},"nodes":[["path",{"d":"M18.5,1.15C17.97,1.15 17.46,1.34 17.07,1.73L11.26,7.55L16.91,13.2L22.73,7.39C23.5,6.61 23.5,5.35 22.73,4.56L19.89,1.73C19.5,1.34 19,1.15 18.5,1.15M10.3,8.5L4.34,14.46C3.56,15.24 3.56,16.5 4.36,17.31C3.14,18.54 1.9,19.77 0.67,21H6.33L7.19,20.14C7.97,20.9 9.22,20.89 10,20.12L15.95,14.16"}]]}}};


;/* native/vendor/semantic-icons-r42/icons.js */
/* Official source geometry; selected paper-figure composes original corner and column nodes. */
(function(root){
 'use strict';
 const R=root.SemanticResources, media=root.matchMedia('(prefers-reduced-motion: reduce)');
 const keys=['navigation','highlights','figures','chat','notes'];
 const names=['导航','高亮','解图','问答','笔记'];
 const sets={
  1:{family:'tabler',assets:['list-details','highlight','photo-scan','message-2','notebook']},
  2:{family:'lucide',assets:['list-tree','highlighter','chart-no-axes-combined','message-square-more','notebook-text']},
  3:{family:'phosphor',assets:['regular/list-dashes','regular/highlighter','regular/image-square','regular/chat-dots','regular/notebook']},
  4:{family:'phosphor',assets:['duotone/list-dashes','duotone/highlighter','duotone/images-square','duotone/chat-dots','duotone/notebook']}
 };
 const esc=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
 const attrs=a=>Object.entries(a).map(([k,v])=>k+'="'+esc(v)+'"').join(' ');
 function node(f,a,i,cls='',style=''){const [tag,v]=R[f][a].nodes[i];return '<'+tag+' '+attrs(v)+' data-source="'+f+'/'+a+':'+i+'" pathLength="1" class="'+cls+'"'+(style?' style="'+style+'"':'')+'/>';}
 function motion(f,a,indices,type){return indices.map((i,k)=>node(f,a,i,'sr-move '+type,'--order:'+k)).join('');}
 function clipped(f,a,i,clip,type,order=0){return '<g class="sr-region" style="clip-path:'+clip+'">'+node(f,a,i,'sr-move '+type,'--order:'+order)+'</g>';}
 function paperFigure(){
  const f='lucide',frame='expand',bars='chart-no-axes-column';
  const corners=[6,3,2,4].map(i=>node(f,frame,i,'sr-native sr-chart-corner')).join('');
  const columns=[0,1,2].map(i=>node(f,bars,i,'sr-native sr-detail-native sr-chart-column')).join('');
  const group=content=>'<g class="sr-bar-group" transform="translate(6 6) scale(.5)">'+content+'</g>';
  return '<svg class="sr-icon sr-figure-chart" viewBox="0 0 24 24" '+attrs(R[f][frame].attrs)+' aria-hidden="true" focusable="false"><g class="sr-base">'+corners+group(columns)+'</g><g class="sr-motion">'+group(motion(f,bars,[0,1,2],'sr-read'))+'</g></svg>';
 }
 function svg(key,set){
  if(key==='figures'&&set===2)return paperFigure();
  const config=sets[set];let f=config.family,a=config.assets[keys.indexOf(key)];
  if(key==='highlights'){f='mdi';a='marker';}
  if(key==='figures'){f='tabler';a='photo-scan';}
  const asset=R[f][a],last=asset.nodes.length-1;
  const detailIndices=set===1?{navigation:[1,2,3,4],chat:[1,2],notes:[2,3]}:{navigation:[0,1,2],chat:[1,2,3],notes:[5,6,7]};
  let base=asset.nodes.map((_,i)=>node(f,a,i,'sr-native'+(f!=='phosphor'&&(key==='figures'?[1,2,3]:detailIndices[key]||[]).includes(i)?' sr-detail-native':''))).join(''),overlay='';
  if(key==='highlights'&&set!==2){
   const nib='inset(70% 64% 6% 0)';
   base='<g style="clip-path:polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,0% 70%,0% 94%,36% 94%,36% 70%,0% 70%)">'+base+'</g>'+clipped(f,a,last,nib,'sr-detail-under');
   overlay=clipped(f,a,last,nib,'sr-nib-read');
  }else if(key==='highlights'){
   // The selected scheme uses the entire original pen, without nib masks or copies.
  }else if(key==='figures'){
   base=asset.nodes.map((_,i)=>node(f,a,i,'sr-native'+([1,2,3].includes(i)?' sr-detail-native':'')+(i>=4?' sr-focus-native':''),'--order:'+Math.max(0,[4,6,7,5].indexOf(i)))).join('');
   overlay=motion(f,a,[2,3],'sr-trace');
  }else if(set===1){
   if(key==='navigation')overlay=motion(f,a,[1,2,3,4],'sr-read');
   if(key==='chat')overlay=motion(f,a,[1,2],'sr-write');
   if(key==='notes')overlay=motion(f,a,[2,3],'sr-write');
  }else if(set===2){
   if(key==='navigation')overlay=motion(f,a,[0,1,2],'sr-read');
   if(key==='chat')overlay=motion(f,a,[3,1,2],'sr-think');
   if(key==='notes')overlay=motion(f,a,[5,6,7],'sr-write');
  }else{
   const regions={navigation:['inset(18% 0 69% 0)','inset(42% 0 44% 0)','inset(67% 0 18% 0)'],chat:['inset(43% 59% 42% 28%)','inset(43% 42% 42% 45%)','inset(43% 25% 42% 62%)'],notes:['inset(38% 26% 51% 38%)','inset(51% 26% 38% 38%)']};
   const holes={navigation:'0% 18%,0% 82%,100% 82%,100% 18%,0% 18%',chat:'27% 42%,27% 58%,76% 58%,76% 42%,27% 42%',notes:'38% 38%,38% 62%,74% 62%,74% 38%,38% 38%'};
   base=asset.nodes.slice(0,-1).map((_,i)=>node(f,a,i,'sr-native')).join('')+'<g style="clip-path:polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,'+holes[key]+')">'+node(f,a,last,'sr-native')+'</g>'+regions[key].map(c=>clipped(f,a,last,c,'sr-detail-under')).join('');
   if(key==='navigation')overlay=[['inset(18% 0 69% 0)'],['inset(42% 0 44% 0)'],['inset(67% 0 18% 0)']].map((c,i)=>clipped(f,a,last,c[0],'sr-read',i)).join('');
   if(key==='chat')overlay=[28,45,62].map((left,i)=>clipped(f,a,last,'inset(43% '+(100-left-13)+'% 42% '+left+'%)','sr-think',i)).join('');
   if(key==='notes')overlay=[38,51].map((top,i)=>clipped(f,a,last,'inset('+top+'% 26% '+(100-top-11)+'% 38%)','sr-fill-write',i)).join('');
  }
  return '<svg class="sr-icon" viewBox="'+asset.viewBox+'" '+attrs(asset.attrs)+' aria-hidden="true" focusable="false"><g class="sr-base">'+base+'</g><g class="sr-motion">'+overlay+'</g></svg>';
 }
 function status(b,state){if(!['idle','running','complete','cancelled','error'].includes(state))throw Error('Unknown state');b.classList.remove('sr-enter');b.dataset.state=state;b.setAttribute('aria-busy',String(state==='running'));const key=b.dataset.module,description={idle:'空闲',running:'AI 运行中',complete:'已完成',cancelled:'已停止',error:'运行失败'}[state];b.setAttribute('aria-label',names[keys.indexOf(key)]+'，'+description);b.title=names[keys.indexOf(key)]+' · '+description+' · 单击切换 / 双击启动或停止';}
 function select(b,on,animate=true){const change=b.dataset.selected!==String(on);b.dataset.selected=String(on);b.setAttribute('aria-pressed',String(on));if(!on)b.classList.remove('sr-enter');if(change&&on&&animate)replay(b);}
 function replay(b){b.classList.remove('sr-enter');void b.offsetWidth;b.classList.add('sr-enter');}
 function decorate(b,key,set){if(!keys.includes(key)||!sets[set])throw Error('Invalid icon');b.classList.add('sr-button');b.dataset.module=key;b.dataset.set=set;b.innerHTML='<span class="sr-slot">'+svg(key,set)+'<span class="sr-busy" aria-hidden="true"></span></span><span class="sr-label">'+names[keys.indexOf(key)]+'</span>';b.addEventListener('animationend',e=>{if(e.animationName==='sr-enter-layer')b.classList.remove('sr-enter');});select(b,false,false);status(b,'idle');return b;}
 function reduced(value){document.documentElement.dataset.reduced=String(value||media.matches);}
 media.addEventListener('change',()=>reduced(document.querySelector('#reduce')?.checked));reduced(false);
 root.SemanticIcons=Object.freeze({keys,names,sets,svg,decorate,status,select,replay,reduced});
})(window);


;/* native/sidebar-module-icons.js */
/* Production task adapter for the selected SemanticIcons 02 / R4.3.
 * Frozen component, original SVGs and licenses: vendor/semantic-icons-r42/.
 * Task dispatch and receipts remain owned by popup.js.
 */
(function(root) {
  'use strict';
  const icons = root.SemanticIcons;
  const names = Object.freeze({ navigation: '导航', highlights: '高亮', figures: '解图', chat: '问答', notes: '笔记' });
  const states = { idle: '就绪', running: 'AI 运行中', complete: '已完成', error: '失败', cancelled: '已停止' };
  const records = new WeakMap();

  function decorate(button, key) {
    if (!Object.hasOwn(names, key)) throw new Error('Unknown module ' + key);
    if (records.has(button)) return button;
    const selected = button.getAttribute('aria-selected') === 'true';
    icons.decorate(button, key, 2);
    button.classList.add('bvi-button');
    button.dataset.bviModule = key;
    button.dataset.scheme = 'semantic-02-r43';
    button.querySelector('.sr-icon').classList.add('bvi-icon');
    button.querySelector('.sr-label')?.remove();
    button.insertAdjacentHTML('beforeend', '<span class="bvi-progress" aria-hidden="true"><span></span></span><span class="bvi-state-text"></span>');
    records.set(button, { key, state: 'idle' });
    setSelected(button, selected, true);
    setState(button, 'idle');
    return button;
  }

  function setSelected(button, selected, instant = false) {
    if (!records.has(button)) throw new Error('Decorate before setting selection');
    icons.select(button, Boolean(selected), !instant);
    button.setAttribute('aria-selected', String(Boolean(selected)));
    // These are tabs, not toggle buttons; preserve the existing tab semantics.
    button.removeAttribute('aria-pressed');
  }

  function setState(button, state, progress = null) {
    if (!Object.hasOwn(states, state)) throw new Error('Unknown status ' + state);
    const record = records.get(button);
    if (!record) throw new Error('Decorate before setting state');
    const previous = record.state;
    if (previous !== state) icons.status(button, state);
    record.state = state;
    button.dataset.status = state;
    button.dataset.indeterminate = String(state === 'running' && !Number.isFinite(progress));
    button.style.setProperty('--bvi-progress', String(Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0));
    const description = names[record.key] + '：' + states[state];
    button.setAttribute('aria-label', description);
    button.setAttribute('aria-busy', String(state === 'running'));
    button.title = description;
    button.querySelector('.bvi-state-text').textContent = states[state];
    if (previous !== state) button.dispatchEvent(new CustomEvent('bvi:statechange', {
      bubbles: true, detail: { module: record.key, status: state, previous }
    }));
  }

  root.BrevessIcons = Object.freeze({
    decorate, setSelected, setState,
    svg: key => icons.svg(key, 2),
    modules: Object.freeze(Object.keys(names)), names,
    resourceVersion: 'SemanticIcons 02 / R4.3 (Lucide, Tabler, MDI)'
  });
})(window);


;/* native/core/llm-task-catalog.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function defineTask(
    id,
    group,
    labelZh,
    requirements,
    budgetKind,
    unitLabelZh,
    defaultReasoning = 'auto',
    defaultTokenRule = 'auto'
  ) {
    return Object.freeze({
      id,
      group,
      labelZh,
      requirements: Object.freeze({ ...requirements }),
      budgetKind,
      unitLabelZh,
      defaultReasoning,
      defaultTokenRule
    });
  }

  const TASK_DEFINITIONS = Object.freeze([
    defineTask('document_highlight', 'reading', '文献高亮', {}, 'highlight', '篇文献'),
    defineTask('literature_radar_query', 'reading', '文献雷达检索式（全局默认）', { textGeneration: true }, 'singleSummary', '条检索式'),
    defineTask('semantic_find', 'reading', '语义查找', {
      typedDecisions: true,
      decisionType: 'noul'
    }, 'highlight', '个候选片段'),
    defineTask('evidence_ledger_review', 'reading', '证据台账审阅', {}, 'batchSummary', '条证据'),
    defineTask('paragraph_summary', 'summary', '段落总结', {}, 'singleSummary', '个段落'),
    defineTask('article_outline_summary', 'summary', '文章大纲总结', {}, 'batchSummary', '篇文章'),
    defineTask('abbreviation_translation', 'reading', '缩写释义与翻译', {}, 'singleSummary', '个缩写'),
    defineTask('figure_walkthrough', 'figure', '图表解读', { vision: true, captionContext: true }, 'figure', '张图'),
    defineTask('figure_panel_interpretation', 'figure', '图版解读', { vision: true, captionContext: true }, 'figurePanel', '个图版'),
    defineTask('figure_panel_followup', 'figure', '图版追问', { vision: true, captionContext: true }, 'panelChat', '次追问'),
    defineTask('cross_figure_mechanism', 'figure', '跨图机制整合', {}, 'crossFigure', '组图'),
    defineTask('paper_research_logic', 'paper_review', '论文研究逻辑', {}, 'batchSummary', '篇论文'),
    defineTask('paper_innovations', 'paper_review', '论文创新点', {}, 'singleSummary', '篇论文'),
    defineTask('paper_limitations', 'paper_review', '论文局限性', {}, 'singleSummary', '篇论文'),
    defineTask('literature_note_autofill', 'paper_review', '文献笔记自动填写', {}, 'batchSummary', '篇论文'),
    defineTask('article_chat', 'chat', '文章问答', {}, 'articleChat', '次对话'),
    defineTask('selection_chat', 'chat', '选中文本问答', {}, 'articleChat', '段选中文本'),
    defineTask('full_text_translation', 'reading', '原文翻译', { translation: true, textGeneration: true }, 'singleSummary', '段原文'),
    defineTask('navigation_title_translation', 'summary', '导航标题翻译', { translation: true, textGeneration: true }, 'singleSummary', '组标题')
  ]);

  const LLM_TASK_IDS = Object.freeze(TASK_DEFINITIONS.map(definition => definition.id));
  const TASKS_BY_ID = Object.freeze(Object.fromEntries(
    TASK_DEFINITIONS.map(definition => [definition.id, definition])
  ));

  function unknownLlmTaskError() {
    const error = new Error('UNKNOWN_LLM_TASK');
    error.code = 'UNKNOWN_LLM_TASK';
    return error;
  }

  function getLlmTaskDefinition(taskId) {
    const normalizedTaskId = String(taskId || '');
    if (Object.prototype.hasOwnProperty.call(TASKS_BY_ID, normalizedTaskId)) {
      return TASKS_BY_ID[normalizedTaskId];
    }
    throw unknownLlmTaskError();
  }

  function taskPolicySignature(taskOrId) {
    const definition = typeof taskOrId === 'string'
      ? getLlmTaskDefinition(taskOrId)
      : taskOrId;
    if (!TASK_DEFINITIONS.includes(definition)) {
      throw unknownLlmTaskError();
    }
    return JSON.stringify({
      id: definition.id,
      requirements: definition.requirements,
      budgetKind: definition.budgetKind,
      defaultReasoning: definition.defaultReasoning,
      defaultTokenRule: definition.defaultTokenRule
    });
  }

  function taskModelForProfile(policy, profile, profileId) {
    if (!policy || !profile || !profileId) return '';
    return policy?.modelProfileId === profileId &&
      (!policy.modelProviderId || policy.modelProviderId === profile?.providerId) &&
      (policy.modelPresetId === undefined || policy.modelPresetId === String(profile?.config?.presetId || ''))
      ? String(policy.model || '').trim() : '';
  }

  // Mirrors the adapters implemented by this build; it is not a claim that
  // every service/model offers a general web-search API.
  function supportsTaskWebSearch(providerId, config = {}, taskId) {
    if (!['article_chat', 'selection_chat'].includes(taskId)) return false;
    if (providerId === 'deepseek-harness') return ['deepseek-flash', 'deepseek-v4-pro'].includes(config.model);
    if (!['openai', 'deepseek'].includes(providerId)) return false;
    if (providerId === 'deepseek' && config.model !== 'deepseek-flash') return false;
    if (!String(config.baseUrl || '').trim()) return true;
    try {
      const url = new URL(config.baseUrl);
      const paths = providerId === 'openai' ? ['/v1/responses']
        : ['/responses', '/chat/completions', '/v1/chat/completions'];
      return url.protocol === 'https:' && url.hostname === `api.${providerId}.com` &&
        !url.port && !url.username && !url.password && !url.search && !url.hash &&
        paths.includes(url.pathname.replace(/\/+$/u, ''));
    } catch { return false; }
  }

  return Object.freeze({
    supportsTaskWebSearch,
    taskModelForProfile,
    LLM_TASK_IDS,
    TASK_DEFINITIONS,
    getLlmTaskDefinition,
    taskPolicySignature
  });
});


;/* native/core/token-budget.js */
(function attach(root, factory) {
  const isCommonJs = typeof module === 'object' && module.exports;
  const shared = root.SciLLM || {};
  if (isCommonJs) Object.assign(shared, require('./llm-task-catalog.js'));
  const api = factory(shared);
  if (isCommonJs) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const MAX_CONFIGURABLE_OUTPUT_TOKENS = 2000000;
  const MAX_TASK_UNITS = 1000000;
  const MAX_TRUNCATION_RETRIES = 10;
  const RULES = Object.freeze({
    highlight: Object.freeze({ base: 2400, perUnit: 320, floor: 4096, ceiling: 16384 }),
    singleSummary: Object.freeze({ base: 800, perUnit: 160, floor: 1024, ceiling: 4096 }),
    batchSummary: Object.freeze({ base: 1400, perUnit: 420, floor: 2048, ceiling: 12288 }),
    figure: Object.freeze({ base: 3200, perUnit: 1400, floor: 6144, ceiling: 24576 }),
    crossFigure: Object.freeze({ base: 3200, perUnit: 1200, floor: 6144, ceiling: 32768 }),
    articleChat: Object.freeze({ base: 4096, perUnit: 512, floor: 4096, ceiling: 32768 }),
    figurePanel: Object.freeze({ base: 3072, perUnit: 0, floor: 2048, ceiling: 8192 }),
    panelChat: Object.freeze({ base: 2048, perUnit: 512, floor: 2048, ceiling: 16384 })
  });

  function roundUp256(value) {
    return Math.ceil(Number(value) / 256) * 256;
  }

  function boundedNumber(value, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(minimum, Math.min(maximum, numeric));
  }

  function validCap(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0
      ? Math.floor(Math.min(numeric, MAX_CONFIGURABLE_OUTPUT_TOKENS)) : null;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function isSafeRuleObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      return !Object.keys(value).some(key =>
        key === '__proto__' || key === 'prototype' || key === 'constructor'
      );
    } catch {
      return false;
    }
  }

  function clampedOrFallback(value, fallback, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(minimum, Math.min(maximum, numeric));
  }

  function boundedInteger(value, fallback, minimum, maximum, infinityMode = 'fallback') {
    const numeric = Number(value);
    if (numeric === Infinity && infinityMode === 'maximum') return Math.floor(maximum);
    if (numeric === -Infinity && infinityMode === 'minimum') return Math.floor(minimum);
    if (!Number.isFinite(numeric)) return Math.floor(fallback);
    return Math.floor(Math.max(minimum, Math.min(maximum, numeric)));
  }

  function normalizedSourceCap(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (numeric === Infinity) return MAX_CONFIGURABLE_OUTPUT_TOKENS;
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return Math.floor(Math.min(numeric, MAX_CONFIGURABLE_OUTPUT_TOKENS));
  }

  function resolveBudgetDefinition(kindOrTaskId) {
    if (own(RULES, kindOrTaskId)) {
      return { budgetKind: kindOrTaskId, catalogTokenRule: 'auto' };
    }
    try {
      const definition = shared.getLlmTaskDefinition(kindOrTaskId);
      if (!own(RULES, definition.budgetKind)) throw new Error('missing rule');
      return {
        budgetKind: definition.budgetKind,
        catalogTokenRule: definition.defaultTokenRule
      };
    } catch {
      throw new Error(`Unknown token budget kind: ${kindOrTaskId}`);
    }
  }

  function normalizeTaskRule(kindOrTaskId, taskRule) {
    const { budgetKind, catalogTokenRule } = resolveBudgetDefinition(kindOrTaskId);
    const baseOutput = RULES[budgetKind];
    const catalogRule = isSafeRuleObject(catalogTokenRule)
      ? catalogTokenRule : {};
    const requestedOverride = isSafeRuleObject(taskRule) ? taskRule : null;
    const override = requestedOverride &&
      (!own(requestedOverride, 'input') || isSafeRuleObject(requestedOverride.input)) &&
      (!own(requestedOverride, 'output') || isSafeRuleObject(requestedOverride.output))
      ? requestedOverride : null;
    const catalogInput = isSafeRuleObject(catalogRule.input)
      ? catalogRule.input : {};
    const catalogOutput = isSafeRuleObject(catalogRule.output)
      ? catalogRule.output : {};
    const overrideInput = isSafeRuleObject(override?.input)
      ? override.input : {};
    const overrideOutput = isSafeRuleObject(override?.output)
      ? override.output : {};
    const inputSource = { ...catalogInput, ...overrideInput };
    const outputSource = { ...catalogOutput, ...overrideOutput };
    const sourceCap = normalizedSourceCap(inputSource.sourceCapTokens);

    const floor = Math.floor(clampedOrFallback(
      outputSource.floor, baseOutput.floor, 512, MAX_CONFIGURABLE_OUTPUT_TOKENS
    ));
    const ceiling = Math.floor(clampedOrFallback(
      outputSource.ceiling, baseOutput.ceiling, floor, MAX_CONFIGURABLE_OUTPUT_TOKENS
    ));
    return {
      budgetKind,
      mode: override ? 'task' : 'auto',
      input: {
        safetyRatio: clampedOrFallback(inputSource.safetyRatio, 1, 0.5, 1),
        reservedTokens: boundedInteger(
          inputSource.reservedTokens, 0, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
        ),
        sourceCapTokens: sourceCap,
        maxUnits: boundedInteger(
          inputSource.maxUnits, MAX_TASK_UNITS, 1, MAX_TASK_UNITS, 'maximum'
        )
      },
      output: {
        base: clampedOrFallback(
          outputSource.base, baseOutput.base, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS
        ),
        perUnit: clampedOrFallback(
          outputSource.perUnit, baseOutput.perUnit, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS
        ),
        floor,
        ceiling,
        truncationRetries: boundedInteger(
          outputSource.truncationRetries, 2, 0, MAX_TRUNCATION_RETRIES
        ),
        retryMultiplier: Number(outputSource.retryMultiplier) > 1 &&
          Number.isFinite(Number(outputSource.retryMultiplier))
          ? Math.min(4, Number(outputSource.retryMultiplier)) : 1.75
      }
    };
  }

  function normalizeTaskTokenRule(taskId, value) {
    if (value === 'auto') return 'auto';
    if (!isSafeRuleObject(value)) return 'auto';
    if (!own(value, 'input') && !own(value, 'output')) return 'auto';
    const normalized = normalizeTaskRule(taskId, value);
    if (normalized.mode !== 'task') return 'auto';
    return {
      input: { ...normalized.input },
      output: { ...normalized.output }
    };
  }

  function computeOutputTokenBudget(kind, options = {}) {
    const normalized = normalizeTaskRule(kind, options.taskRule);
    const rule = normalized.output;
    const tokenPolicy = options.tokenPolicy || {};
    if (tokenPolicy.mode === 'manual') {
      const requested = Number(tokenPolicy.manualMax);
      const manual = Number.isFinite(requested) && requested > 0
        ? boundedNumber(requested, 512, MAX_CONFIGURABLE_OUTPUT_TOKENS)
        : 4096;
      const adapterCap = validCap(options.adapterCap);
      const roundedAdapterCap = adapterCap
        ? Math.max(1, Math.floor(adapterCap))
        : MAX_CONFIGURABLE_OUTPUT_TOKENS;
      const fixed = Math.min(
        MAX_CONFIGURABLE_OUTPUT_TOKENS,
        roundedAdapterCap,
        roundUp256(manual)
      );
      return { initial: fixed, ceiling: fixed, mode: 'manual' };
    }

    const autoCap = validCap(tokenPolicy.autoCap);
    const adapterCap = validCap(options.adapterCap);
    let ceiling;
    if (normalized.mode === 'task') {
      ceiling = rule.ceiling;
      if (autoCap !== null) ceiling = Math.min(ceiling, Math.max(rule.floor, autoCap));
    } else {
      ceiling = autoCap !== null
        ? Math.max(rule.floor, autoCap)
        : (adapterCap !== null ? adapterCap : rule.ceiling);
    }
    if (adapterCap !== null) ceiling = Math.min(ceiling, adapterCap);
    ceiling = Math.max(1, Math.min(MAX_CONFIGURABLE_OUTPUT_TOKENS, ceiling));
    const units = Math.min(
      normalized.input.maxUnits,
      Math.max(1, Number(options.units) || 0)
    );
    const initial = Math.min(
      ceiling,
      rule.ceiling,
      Math.max(rule.floor, roundUp256(rule.base + rule.perUnit * units))
    );
    const budget = { initial, ceiling, mode: normalized.mode };
    if (!['figure', 'articleChat', 'panelChat'].includes(normalized.budgetKind) ||
        String(options.reasoningProviderId || '') !== 'deepseek' ||
        options.reasoningEnabled !== true ||
        !['high', 'max'].includes(String(options.reasoningEffort || ''))) {
      return budget;
    }
    // DeepSeek counts hidden reasoning and the final structured JSON against
    // the same output limit. Preserve the normal Figure budget for the JSON,
    // then add a bounded reasoning reserve for high-effort automatic runs.
    // Manual limits remain exact user choices and return above this branch.
    const effort = String(options.reasoningEffort);
    const reserve = effort === 'max'
      ? Math.max(24576, roundUp256(initial * 1.5))
      : Math.max(16384, initial);
    const contextCap = validCap(options.contextWindowTokens);
    const contextCeiling = contextCap === null
      ? ceiling
      : Math.max(1, Math.floor(contextCap * 0.5 / 256) * 256);
    return {
      initial: Math.min(ceiling, contextCeiling, roundUp256(initial + reserve)),
      ceiling,
      mode: normalized.mode
    };
  }

  function computeInputTokenBudget(options = {}) {
    const taskRule = isSafeRuleObject(options.taskRule) ? options.taskRule : null;
    const taskInput = isSafeRuleObject(taskRule?.input) ? taskRule.input : {};
    const contextWindowTokens = boundedInteger(
      options.contextWindowTokens, 1, 1, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
    );
    const outputTokens = boundedInteger(
      options.outputTokens, 0, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
    );
    const requestedReservedTokens = own(taskInput, 'reservedTokens')
      ? taskInput.reservedTokens : options.reservedTokens;
    const reservedTokens = boundedInteger(
      requestedReservedTokens, 0, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
    );
    const systemTokens = boundedInteger(
      options.systemTokens, 0, 0, MAX_CONFIGURABLE_OUTPUT_TOKENS, 'maximum'
    );
    const requestedSafetyRatio = own(taskInput, 'safetyRatio')
      ? taskInput.safetyRatio : options.safetyRatio;
    const safetyRatio = clampedOrFallback(requestedSafetyRatio, 1, 0.5, 1);
    const usableContextWindowTokens = Math.floor(contextWindowTokens * safetyRatio);
    const contextAvailable = Math.max(
      0,
      usableContextWindowTokens - outputTokens - reservedTokens - systemTokens
    );
    const sourceCap = normalizedSourceCap(taskInput.sourceCapTokens);
    return {
      contextWindowTokens,
      outputTokens,
      reservedTokens,
      systemTokens,
      usableContextWindowTokens,
      available: sourceCap === null
        ? contextAvailable
        : Math.min(contextAvailable, Math.floor(sourceCap))
    };
  }

  function suggestedLimit(error) {
    const suggested = Number(error?.suggestedMaxOutputTokens);
    return Number.isFinite(suggested) && suggested >= 512 &&
      suggested <= MAX_CONFIGURABLE_OUTPUT_TOKENS ? suggested : null;
  }

  function lowerRetryLimit(value, current) {
    const rounded = Math.max(256, Math.floor(Number(value) / 256) * 256);
    return Math.max(1, Math.min(Math.floor(current) - 1, rounded));
  }

  function requestUnits(request) {
    const supplied = Number(request?.outputUnits);
    if (Number.isFinite(supplied) && supplied > 0) return supplied;
    return Array.isArray(request?.paragraphs) ? request.paragraphs.length : 1;
  }

  function createTokenManagedAdapter({
    rawAdapter,
    kind,
    tokenPolicy = {},
    taskRule = null,
    adapterCap = null,
    contextWindowTokens = null,
    reasoningProviderId = '',
    reasoningEnabled = false,
    reasoningEffort = 'auto',
    requestTimeoutMs = null,
    progressHeartbeatMs = 0,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    nowImpl = Date.now,
    maxTokenLimitRetries = 1,
    maxTruncationRetries = null,
    onProgress = () => {}
  }) {
    if (!rawAdapter || typeof rawAdapter !== 'object') throw new Error('A raw adapter is required');

    function report(progress) {
      if (typeof onProgress !== 'function') return;
      try { onProgress(progress); } catch { /* Progress reporting must not alter request handling. */ }
    }

    async function invoke(method, request = {}) {
      const budget = computeOutputTokenBudget(kind, {
        tokenPolicy,
        taskRule,
        adapterCap,
        contextWindowTokens,
        reasoningProviderId,
        reasoningEnabled,
        reasoningEffort,
        units: requestUnits(request)
      });
      const normalizedRule = normalizeTaskRule(kind, taskRule);
      const effectiveMaxTruncationRetries = maxTruncationRetries === null
        ? normalizedRule.output.truncationRetries
        : Math.floor(clampedOrFallback(
          maxTruncationRetries, normalizedRule.output.truncationRetries, 0, MAX_TRUNCATION_RETRIES
        ));
      const retryMultiplier = normalizedRule.output.retryMultiplier;
      let current = budget.initial;
      // A caller may retain an already-used automatic budget for schema repair.
      // The hint cannot raise the effective cap or override a manual limit.
      if (budget.mode !== 'manual' && Number.isFinite(request.initialOutputTokens) &&
          request.initialOutputTokens > 0) {
        current = Math.min(budget.ceiling, Math.max(current, roundUp256(request.initialOutputTokens)));
      }
      let effectiveCeiling = budget.ceiling;
      // Preserve a provider-rejected limit across the caller's schema repair.
      // This hint may only lower an automatic budget; manual behavior is fixed.
      if (budget.mode !== 'manual' && Number.isFinite(request.outputTokenCeiling) && request.outputTokenCeiling >= 1) {
        effectiveCeiling = Math.min(effectiveCeiling, Math.floor(request.outputTokenCeiling));
        current = Math.min(current, effectiveCeiling);
      }
      let limitedRetried = false;
      let truncationRetries = 0;
      while (true) {
        const timeoutMs = request.timeoutMs || requestTimeoutMs || undefined;
        const heartbeatMs = Math.max(0, Number(progressHeartbeatMs) || 0);
        const startedAt = nowImpl();
        let heartbeatId = null;
        if (heartbeatMs > 0) {
          report({ phase: 'provider_request_started', timeoutMs: Number(timeoutMs) || 0 });
          heartbeatId = setIntervalImpl(() => {
            report({
              phase: 'provider_waiting',
              elapsedSeconds: Math.max(0, Math.floor((nowImpl() - startedAt) / 1000)),
              timeoutMs: Number(timeoutMs) || 0
            });
          }, heartbeatMs);
        }
        try {
          const upstreamTelemetry = request.onProviderTelemetry;
          const attemptedOutputTokens = current;
          return await rawAdapter[method]({
            ...request,
            maxOutputTokens: attemptedOutputTokens,
            timeoutMs,
            onProviderTelemetry: event => {
              const observed = { ...event, maxOutputTokens: attemptedOutputTokens };
              try { upstreamTelemetry?.(observed); } catch { /* Keep provider result intact. */ }
              report({ phase: 'provider_telemetry', ...observed });
            }
          });
        } catch (error) {
          if (error?.code === 'TOKEN_LIMIT_REJECTED' && !limitedRetried && current > 1 &&
              Math.max(0, Number(maxTokenLimitRetries) || 0) > 0) {
            limitedRetried = true;
            const suggested = suggestedLimit(error);
            current = suggested && suggested < current
              ? lowerRetryLimit(suggested, current)
              : lowerRetryLimit(current * 0.75, current);
            effectiveCeiling = Math.min(effectiveCeiling, current);
            try { request.onOutputTokenLimit?.(effectiveCeiling); } catch { /* Keep provider handling intact. */ }
            report({ phase: 'token_limit_retry', maxOutputTokens: current });
            continue;
          }
          if (
            error?.code === 'OUTPUT_TRUNCATED' && budget.mode !== 'manual' &&
            truncationRetries < effectiveMaxTruncationRetries &&
            current < effectiveCeiling
          ) {
            const next = Math.min(effectiveCeiling, roundUp256(current * retryMultiplier));
            if (!Number.isFinite(next) || next <= current) throw error;
            truncationRetries += 1;
            current = next;
            report({
              phase: 'output_token_retry',
              maxOutputTokens: current,
              retry: truncationRetries,
              maxRetries: effectiveMaxTruncationRetries
            });
            continue;
          }
          throw error;
        } finally {
          if (heartbeatId !== null) clearIntervalImpl(heartbeatId);
        }
      }
    }

    async function* stream(method, request = {}) {
      if (typeof rawAdapter[method] !== 'function') {
        throw new Error('The selected provider does not support text streaming');
      }
      const budget = computeOutputTokenBudget(kind, {
        tokenPolicy,
        taskRule,
        adapterCap,
        contextWindowTokens,
        reasoningProviderId,
        reasoningEnabled,
        reasoningEffort,
        units: requestUnits(request)
      });
      const suppliedLimit = validCap(request.maxOutputTokens);
      const maxOutputTokens = suppliedLimit
        ? Math.min(suppliedLimit, budget.ceiling)
        : budget.initial;
      const upstreamTelemetry = request.onProviderTelemetry;
      yield* rawAdapter[method]({
        ...request,
        maxOutputTokens,
        timeoutMs: request.timeoutMs || requestTimeoutMs || undefined,
        onProviderTelemetry: event => {
          try { upstreamTelemetry?.(event); } catch { /* Keep provider stream intact. */ }
          report({ phase: 'provider_telemetry', maxOutputTokens, ...event });
        }
      });
    }

    const managedAdapter = Object.assign({}, rawAdapter, {
      generateJson(request) { return invoke('generateJson', request); },
      analyzeChunk(request) { return invoke('analyzeChunk', request); }
    });
    if (typeof rawAdapter.generateTextStream === 'function') {
      managedAdapter.generateTextStream = request => stream('generateTextStream', request);
    }
    if (typeof rawAdapter.generateWebSearchTextStream === 'function') {
      managedAdapter.generateWebSearchTextStream = request =>
        stream('generateWebSearchTextStream', request);
    }
    return managedAdapter;
  }

  return {
    RULES,
    normalizeTaskTokenRule,
    computeOutputTokenBudget,
    computeInputTokenBudget,
    createTokenManagedAdapter
  };
});


;/* native/core/tts-service.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const TTS_MAX_TEXT_CHARACTERS = 5000;
  const TTS_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
  const TTS_REQUEST_TIMEOUT_MS = 45000;
  const TTS_LOCAL_ENDPOINT = 'http://127.0.0.1:8880/v1/audio/speech';
  const TTS_DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/tools/tts';
  const TTS_DEEPSEEK_VOICES = [{ id: 'stella', name: 'Stella · 女声' }, { id: 'tide', name: 'Tide · 男声' }];
  const voicePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,79}$/;
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const string = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
  // Voice URIs are opaque browser identifiers. Keep spaces/Unicode exactly;
  // malformed types remain invalid instead of becoming the automatic choice.
  const browserVoice = value => value === undefined ? '' : typeof value === 'string' ? value : '\u0000';
  const errors = {
    TTS_BROWSER_ONLY: '浏览器内置朗读应在当前页面播放，无需连接语音服务。',
    TTS_NOT_CONFIGURED: '请先保存完整的朗读服务配置。',
    TTS_INVALID_ENDPOINT: '朗读地址须为本机回环地址，或已配置的 HTTPS 在线语音接口。',
    TTS_INVALID_TEXT: '请选择 1–5000 个字符后朗读。',
    TTS_INVALID_VOICE: '请填写有效的中文或英文音色 ID。',
    TTS_INVALID_CONFIG: '朗读模型或密钥格式无效。',
    TTS_CANCELLED: '朗读已停止。',
    TTS_TIMEOUT: '朗读服务超时，请检查服务后重试。',
    TTS_NETWORK: '无法连接朗读服务，请确认服务已启动及地址可访问。',
    TTS_HTTP: '朗读服务拒绝了请求，请检查设置。',
    TTS_REDIRECT: '朗读服务发生跳转，已停止请求。请填写最终接口地址。',
    TTS_RESPONSE_TYPE: '朗读服务未返回支持的音频。',
    TTS_RESPONSE_SIZE: '朗读响应为空或超过大小限制，请缩短选区。',
    TTS_COMPATIBILITY: '此服务不支持 JSON 朗读模式；可在朗读设置中选择自动兼容或标准音频。',
    TTS_VOICES: '服务未返回音色列表；可以手动填写音色 ID。'
  };
  const diagnosticPhases = new Set(['settings', 'discovery', 'synthesis', 'receiving', 'decode-pcm', 'decode-audio', 'playback']);
  function ttsError(code, value) {
    const error = Object.assign(new Error(errors[code] || errors.TTS_NETWORK), { code });
    if (value && typeof value === 'object') {
      const details = {};
      if (diagnosticPhases.has(value.phase)) details.phase = value.phase;
      for (const key of ['elapsedMs', 'httpStatus', 'audioBytes']) {
        const number = value[key];
        if (Number.isSafeInteger(number) && number >= 0 &&
            (key !== 'httpStatus' || (number >= 100 && number <= 599)) &&
            (key !== 'audioBytes' || number <= TTS_MAX_AUDIO_BYTES * 2)) details[key] = number;
      }
      error.ttsDetails = details;
    }
    return error;
  }

  function normalizeTtsSettings(value) {
    const raw = plain(value);
    const local = plain(raw.local);
    const online = plain(raw.online);
    const deepseek = plain(raw.deepseek);
    const browser = plain(raw.browser);
    const speed = Number(raw.speed);
    return {
      mode: ['local', 'online', 'deepseek'].includes(raw.mode) ? raw.mode : 'browser',
      autoPlay: raw.autoPlay === true,
      speed: Number.isFinite(speed) && speed >= 0.25 && speed <= 4 ? speed : 1,
      browser: { voiceEn: browserVoice(browser.voiceEn), voiceZh: browserVoice(browser.voiceZh) },
      local: {
        endpoint: string(local.endpoint, TTS_LOCAL_ENDPOINT), model: string(local.model, 'kokoro'),
        transport: ['json-pcm', 'standard'].includes(local.transport) ? local.transport : 'auto',
        voiceEn: string(local.voiceEn, 'af_heart'), voiceZh: string(local.voiceZh, 'zf_xiaoxiao')
      },
      online: {
        endpoint: string(online.endpoint), model: string(online.model),
        voiceEn: string(online.voiceEn), voiceZh: string(online.voiceZh), apiKey: string(online.apiKey)
      },
      deepseek: {
        endpoint: TTS_DEEPSEEK_ENDPOINT,
        voiceEn: string(deepseek.voiceEn, 'stella'), voiceZh: string(deepseek.voiceZh, 'stella'),
        apiKey: string(deepseek.apiKey)
      }
    };
  }

  function mergeTtsSettings(current, patch) {
    const before = normalizeTtsSettings(current);
    const update = plain(patch);
    return normalizeTtsSettings({ ...before, ...update,
      browser: { ...before.browser, ...plain(update.browser) },
      local: { ...before.local, ...plain(update.local) },
      online: { ...before.online, ...plain(update.online) },
      deepseek: { ...before.deepseek, ...plain(update.deepseek) }
    });
  }

  function toPublicTtsSettings(value) {
    const settings = normalizeTtsSettings(value);
    const { apiKey, ...online } = settings.online;
    const { apiKey: deepseekKey, ...deepseek } = settings.deepseek;
    return { ...settings, online: { ...online, hasApiKey: Boolean(apiKey) },
      deepseek: { ...deepseek, hasApiKey: Boolean(deepseekKey) } };
  }

  // Resolve an existing official connection only in the background. Never copy
  // its credential into the saved TTS settings or expose it to reading pages.
  function resolveTtsSettings(settings = {}) {
    const tts = normalizeTtsSettings(settings.tts);
    if (tts.mode !== 'deepseek' || tts.deepseek.apiKey) return tts;
    const profiles = Object.entries(settings.profiles || {});
    profiles.sort(([a], [b]) => Number(b === settings.globalProfileId) - Number(a === settings.globalProfileId));
    const profile = profiles.map(([, p]) => p).find(p => {
      if (p?.providerId !== 'deepseek' || !string(p.config?.apiKey)) return false;
      if (!p.config.baseUrl) return true;
      try { const u = new URL(p.config.baseUrl); return u.origin === 'https://api.deepseek.com' &&
        !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
    });
    if (profile) tts.deepseek.apiKey = string(profile.config.apiKey);
    return tts;
  }

  function validateTtsEndpoint(endpoint, mode) {
    if (mode === 'deepseek') {
      if (endpoint !== TTS_DEEPSEEK_ENDPOINT) throw ttsError('TTS_INVALID_ENDPOINT');
      return endpoint;
    }
    let url;
    try { url = new URL(endpoint); } catch { throw ttsError('TTS_INVALID_ENDPOINT'); }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase());
    if (url.username || url.password || url.search || url.hash ||
        !url.pathname.endsWith('/audio/speech') || url.href.length > 2048 ||
        (mode === 'local' ? !loopback || !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:')) {
      throw ttsError('TTS_INVALID_ENDPOINT');
    }
    return url.href;
  }

  function activeConfig(value) {
    const settings = normalizeTtsSettings(value);
    if (settings.mode === 'browser') throw ttsError('TTS_BROWSER_ONLY');
    const config = settings[settings.mode];
    if (!config.endpoint || (settings.mode === 'deepseek' ? !config.apiKey : !config.model)) throw ttsError('TTS_NOT_CONFIGURED');
    const endpoint = validateTtsEndpoint(config.endpoint, settings.mode);
    if ((config.model || '').length > 120 || /[\u0000-\u001f\u007f]/u.test(config.model || '') ||
        (config.apiKey && (config.apiKey.length > 4096 || /[\u0000-\u001f\u007f]/u.test(config.apiKey)))) {
      throw ttsError('TTS_INVALID_CONFIG');
    }
    return { settings, config, endpoint };
  }

  function getTtsPublicSettings(value) {
    const settings = normalizeTtsSettings(value);
    if (settings.mode === 'browser') {
      return { mode: settings.mode, autoPlay: settings.autoPlay, speed: settings.speed, configured: true,
        browser: { ...settings.browser } };
    }
    let configured = false;
    try {
      const { config } = activeConfig(settings);
      configured = voicePattern.test(config.voiceEn) && voicePattern.test(config.voiceZh);
    } catch { /* Invalid saved configuration must never cause a fallback upload. */ }
    return { mode: settings.mode, autoPlay: settings.autoPlay, speed: settings.speed, configured };
  }

  function validateBrowserTtsSettings(value) {
    const { browser } = normalizeTtsSettings(value);
    for (const voice of [browser.voiceEn, browser.voiceZh]) {
      if (voice.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(voice)) throw ttsError('TTS_INVALID_VOICE');
    }
  }

  function normalizeTtsVoices(value) {
    const candidates = Array.isArray(value) ? value : (value?.voices || value?.data);
    if (!Array.isArray(candidates)) throw ttsError('TTS_VOICES');
    const seen = new Set();
    const voices = [];
    for (const item of candidates.slice(0, 256)) {
      const id = string(typeof item === 'string' ? item : item?.id);
      if (!voicePattern.test(id) || seen.has(id)) continue;
      seen.add(id);
      voices.push({ id, name: string(item?.name, id).replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 100) || id });
    }
    if (!voices.length) throw ttsError('TTS_VOICES');
    return { voices, defaultVoice: seen.has(value?.default_voice) ? value.default_voice : '' };
  }

  function encodedAudio(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    }
    return btoa(binary);
  }

  function hasAudioSignature(bytes, mimeType) {
    if (mimeType === 'audio/mpeg') {
      return bytes.length >= 3 && ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
    }
    return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE';
  }

  function createTtsService(options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const kokoroCapabilities = new Map();
    // Injectable shorter deadlines support deterministic tests; production cannot raise the cap.
    const timeoutMs = Math.max(1, Math.min(TTS_REQUEST_TIMEOUT_MS, Number(options.timeoutMs) || TTS_REQUEST_TIMEOUT_MS));
    async function requestBytes(endpoint, init, { signal, limit, acceptedTypes, phase = 'synthesis', deadline = Date.now() + timeoutMs }) {
      const started = Date.now();
      let stage = phase, httpStatus, total = 0;
      const diagnostics = () => ({ phase: stage, elapsedMs: Math.max(0, Date.now() - started), httpStatus, audioBytes: total });
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      if (signal?.aborted) throw ttsError('TTS_CANCELLED', diagnostics());
      signal?.addEventListener('abort', abort, { once: true });
      const remaining = Math.min(timeoutMs, deadline - Date.now());
      if (remaining <= 0) { signal?.removeEventListener('abort', abort); throw ttsError('TTS_TIMEOUT', diagnostics()); }
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, remaining);
      let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = () => reject(ttsError(timedOut ? 'TTS_TIMEOUT' : 'TTS_CANCELLED')); });
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      let reader;
      try {
        const response = await Promise.race([fetchImpl(endpoint, { ...init, signal: controller.signal,
          redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }), aborted]);
        httpStatus = response.status;
        if (response.redirected || (response.url && response.url !== endpoint) ||
            (response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') throw ttsError('TTS_REDIRECT');
        if (!response.ok) throw ttsError('TTS_HTTP');
        let mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (['audio/mp3', 'audio/x-mp3'].includes(mimeType)) mimeType = 'audio/mpeg';
        if (mimeType === 'audio/x-wav') mimeType = 'audio/wav';
        if (!acceptedTypes.includes(mimeType)) throw ttsError('TTS_RESPONSE_TYPE');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit || Number(length) < 1)) throw ttsError('TTS_RESPONSE_SIZE');
        if (!response.body?.getReader) throw ttsError('TTS_RESPONSE_TYPE');
        reader = response.body.getReader();
        stage = phase === 'discovery' ? 'discovery' : 'receiving';
        const chunks = [];
        while (true) {
          const { done, value } = await Promise.race([reader.read(), aborted]);
          if (done) break;
          total += value.byteLength;
          if (total > limit) throw ttsError('TTS_RESPONSE_SIZE');
          chunks.push(value);
        }
        if (!total || (length !== null && !response.headers.get('content-encoding') && total !== Number(length))) throw ttsError('TTS_RESPONSE_SIZE');
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return { bytes, mimeType };
      } catch (error) {
        if (controller.signal.aborted) throw ttsError(timedOut ? 'TTS_TIMEOUT' : 'TTS_CANCELLED', diagnostics());
        if (Object.hasOwn(errors, error?.code)) throw ttsError(error.code, diagnostics());
        throw ttsError('TTS_NETWORK', diagnostics());
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', rejectAbort);
        if (reader) { try { void reader.cancel().catch(() => {}); } catch { /* Already closed. */ } }
        controller.abort();
      }
    }

    async function kokoroJsonEndpoint(endpoint, signal, deadline) {
      const base = endpoint.replace(/\/(?:v1\/)?audio\/speech$/u, '');
      const target = `${base}/dev/captioned_speech`;
      if (kokoroCapabilities.get(endpoint) > Date.now()) return target;
      const { bytes } = await requestBytes(`${base}/openapi.json`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        { signal, phase: 'discovery', deadline: Math.min(deadline, Date.now() + 5000), limit: 256 * 1024, acceptedTypes: ['application/json'] });
      let spec;
      try { spec = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw ttsError('TTS_COMPATIBILITY', { phase: 'discovery' }); }
      const post = spec?.paths?.['/dev/captioned_speech']?.post;
      const ref = post?.requestBody?.content?.['application/json']?.schema?.$ref;
      const schemaName = typeof ref === 'string' && /^#\/components\/schemas\/[A-Za-z0-9_]+$/u.test(ref) ? ref.split('/').at(-1) : '';
      const properties = spec?.components?.schemas?.[schemaName]?.properties;
      if (!/kokoro/iu.test(String(spec?.info?.title || '')) ||
          !properties?.response_format?.enum?.includes?.('pcm') ||
          properties?.stream?.type !== 'boolean' || properties?.return_timestamps?.type !== 'boolean') {
        throw ttsError('TTS_COMPATIBILITY', { phase: 'discovery' });
      }
      if (kokoroCapabilities.size >= 16) kokoroCapabilities.delete(kokoroCapabilities.keys().next().value);
      kokoroCapabilities.set(endpoint, Date.now() + 5 * 60 * 1000);
      return target;
    }

    function pcmJsonToWav(bytes) {
      let response;
      try { response = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw ttsError('TTS_RESPONSE_TYPE'); }
      const audio = response?.audio;
      if (response?.audio_format !== 'audio/pcm' || typeof audio !== 'string' || !audio.length ||
          audio.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(audio)) throw ttsError('TTS_RESPONSE_TYPE');
      const size = audio.length / 4 * 3 - (audio.endsWith('==') ? 2 : audio.endsWith('=') ? 1 : 0);
      if (size + 44 > TTS_MAX_AUDIO_BYTES) throw ttsError('TTS_RESPONSE_SIZE');
      if (size < 2 || size % 2) throw ttsError('TTS_RESPONSE_TYPE');
      let raw;
      try { raw = atob(audio); } catch { throw ttsError('TTS_RESPONSE_TYPE'); }
      if (raw.length !== size) throw ttsError('TTS_RESPONSE_TYPE');
      // Kokoro's PCM writer emits mono signed 16-bit little-endian at 24 kHz.
      // Only this in-memory WAV reaches the player; the HTTP response is JSON.
      const wav = new Uint8Array(44 + size);
      const view = new DataView(wav.buffer);
      const label = (offset, text) => { for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i); };
      label(0, 'RIFF'); view.setUint32(4, 36 + size, true); label(8, 'WAVE'); label(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, size, true);
      for (let i = 0; i < size; i++) wav[44 + i] = raw.charCodeAt(i);
      return wav;
    }

    async function synthesize(input, { settings: value, signal } = {}) {
        const deadline = Date.now() + timeoutMs;
        const { settings, config, endpoint } = activeConfig(value);
        const text = typeof input?.text === 'string' ? input.text.trim() : '';
        if (!text || Array.from(text).length > TTS_MAX_TEXT_CHARACTERS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw ttsError('TTS_INVALID_TEXT');
        const language = input?.language === 'zh' || (input?.language !== 'en' && /\p{Script=Han}/u.test(text)) ? 'zh' : 'en';
        const voice = language === 'zh' ? config.voiceZh : config.voiceEn;
        if (!voicePattern.test(voice)) throw ttsError('TTS_INVALID_VOICE');
        const deepseek = settings.mode === 'deepseek';
        if (deepseek && !TTS_DEEPSEEK_VOICES.some(item => item.id === voice)) throw ttsError('TTS_INVALID_VOICE');
        const body = deepseek ? { text, voice_id: voice, format: 'pcm', filter_markdown: true }
          : { model: config.model, input: text, voice, response_format: 'mp3', speed: settings.speed };
        if (settings.mode === 'local') Object.assign(body, { stream: false, return_download_link: false, allow_voice_tags: false, ssml: false });
        let target = '';
        if (settings.mode === 'local' && config.transport !== 'standard' && /^kokoro(?:[-_].*)?$/iu.test(config.model)) {
          try { target = await kokoroJsonEndpoint(endpoint, signal, deadline); }
          catch (error) {
            // Capability discovery carries no selected text. Older compatible
            // services retain their original endpoint when discovery is absent.
            if (signal?.aborted || ['TTS_CANCELLED', 'TTS_REDIRECT'].includes(error?.code) || Date.now() >= deadline) throw error;
            if (config.transport === 'json-pcm') throw ttsError('TTS_COMPATIBILITY', error?.ttsDetails || { phase: 'discovery' });
          }
        } else if (settings.mode === 'local' && config.transport === 'json-pcm') throw ttsError('TTS_COMPATIBILITY');
        if (target) {
          if (signal?.aborted) throw ttsError('TTS_CANCELLED');
          Object.assign(body, { response_format: 'pcm', return_timestamps: false });
          const result = await requestBytes(target, { method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
          { signal, deadline, limit: Math.ceil(TTS_MAX_AUDIO_BYTES / 3) * 4 + 65536, acceptedTypes: ['application/json'] });
          let wav;
          try { wav = pcmJsonToWav(result.bytes); }
          catch (error) { throw ttsError(error.code, { phase: 'decode-pcm', audioBytes: result.bytes.length }); }
          return { audioBase64: encodedAudio(wav), mimeType: 'audio/wav', byteLength: wav.length, voice, language };
        }
        const headers = { 'Content-Type': 'application/json', Accept: 'audio/mpeg, audio/wav' };
        if (['online', 'deepseek'].includes(settings.mode) && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
        if (deepseek) {
          headers.Accept = 'audio/pcm, application/octet-stream';
          const { bytes } = await requestBytes(endpoint, { method: 'POST', headers, body: JSON.stringify(body) },
            { signal, deadline, limit: TTS_MAX_AUDIO_BYTES - 44, acceptedTypes: ['audio/pcm', 'application/octet-stream', 'audio/L16'.toLowerCase()] });
          if (bytes.length % 2) throw ttsError('TTS_RESPONSE_TYPE');
          const wav = pcmJsonToWav(new TextEncoder().encode(JSON.stringify({ audio_format: 'audio/pcm', audio: encodedAudio(bytes) })));
          return { audioBase64: encodedAudio(wav), mimeType: 'audio/wav', byteLength: wav.length,
            voice, language, playbackRate: settings.speed };
        }
        const { bytes, mimeType } = await requestBytes(endpoint, { method: 'POST', headers, body: JSON.stringify(body) },
          { signal, deadline, limit: TTS_MAX_AUDIO_BYTES, acceptedTypes: ['audio/mpeg', 'audio/wav'] });
        if (!hasAudioSignature(bytes, mimeType)) throw ttsError('TTS_RESPONSE_TYPE', { phase: 'decode-audio', audioBytes: bytes.length });
        return { audioBase64: encodedAudio(bytes), mimeType, byteLength: bytes.length, voice, language };
    }
    return {
      async synthesize(input, options) {
        const started = Date.now();
        try { return await synthesize(input, options); }
        catch (error) {
          const code = Object.hasOwn(errors, error?.code) ? error.code : 'TTS_NETWORK';
          throw ttsError(code, { phase: 'settings', ...error?.ttsDetails, elapsedMs: Math.max(0, Date.now() - started) });
        }
      },
      async listVoices({ settings: value, signal } = {}) {
        if (normalizeTtsSettings(value).mode === 'deepseek') return { voices: TTS_DEEPSEEK_VOICES.map(v => ({ ...v })), defaultVoice: 'stella' };
        const { settings, config, endpoint } = activeConfig(value);
        const url = endpoint.slice(0, -'speech'.length) + 'voices';
        const headers = { Accept: 'application/json' };
        if (settings.mode === 'online' && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
        const { bytes } = await requestBytes(url, { method: 'GET', headers },
          { signal, limit: 128 * 1024, acceptedTypes: ['application/json'] });
        try { return normalizeTtsVoices(JSON.parse(new TextDecoder().decode(bytes))); }
        catch { throw ttsError('TTS_VOICES'); }
      }
    };
  }
  return { TTS_MAX_TEXT_CHARACTERS, TTS_MAX_AUDIO_BYTES, TTS_REQUEST_TIMEOUT_MS, TTS_LOCAL_ENDPOINT, TTS_DEEPSEEK_ENDPOINT, TTS_DEEPSEEK_VOICES,
    resolveTtsSettings,
    normalizeTtsSettings, mergeTtsSettings, toPublicTtsSettings, getTtsPublicSettings,
    validateTtsEndpoint, validateBrowserTtsSettings, normalizeTtsVoices, createTtsService };
});

