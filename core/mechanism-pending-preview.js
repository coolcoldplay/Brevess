(function attach(root, factory) {
  const api = factory(root.SciLLM || {}, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared, host) {
  'use strict';

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

  function reviewReason(value) { return REVIEW_REASON[value] || value; }

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
    return `${RELATION_KIND[relation.relationKind] || '关系性质未确定'} · ` +
      `${POLARITY[relation.polarity] || '方向未确定'} · ${status}`;
  }

  function relationContext(relation) {
    const fields = [
      ['物种', relation.context.species], ['组织', relation.context.tissue],
      ['细胞', relation.context.cellType], ['区室', relation.context.compartment],
      ['条件', relation.context.condition], ['时间', relation.context.timepoint],
      ['剂量', relation.context.dose]
    ].filter(([, value]) => text(value));
    return fields.length
      ? fields.map(([label, value]) => `${label}：${text(value)}`).join('；')
      : '实验上下文未提供';
  }

  function panelEvidenceItem(assignment) {
    const references = assignment.sourceRefs.length
      ? `；来源：${assignment.sourceRefs.join('、')}` : '；来源定位未提供';
    return {
      panelKey: assignment.panelKey,
      evidenceClass: EVIDENCE_CLASS[assignment.evidenceClass] || '证据类型未确定',
      role: ROLE[assignment.role] || '作用未确定',
      sourceRefs: [...assignment.sourceRefs],
      label: `${assignment.panelKey} · ${EVIDENCE_CLASS[assignment.evidenceClass] || '证据类型未确定'}` +
        ` · ${ROLE[assignment.role] || '作用未确定'}${references}`
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
    const label = nodeId => nodesById.get(nodeId)?.label || '未知节点';
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
      const reason = disposition?.reason ? `；原因：${reviewReason(disposition.reason)}` : '';
      nonRelationEvidence.push({
        key: `usage:${usage.claimId}`,
        panelKey: usage.panelKey,
        kind: USAGE_KIND[usage.usageKind] || '无关系证据',
        nodes: usage.nodeIds.map(label),
        detail: claim?.sourceRefs?.length
          ? `来源：${claim.sourceRefs.join('、')}${reason}` : `来源定位未提供${reason}`
      });
    }
    for (const unresolved of preview.unresolvedClaims || []) {
      const claim = claimsById.get(unresolved.claimId);
      nonRelationEvidence.push({
        key: `unresolved:${unresolved.claimId}`,
        panelKey: unresolved.panelKey,
        kind: '未解析证据',
        nodes: [],
        detail: `原因：${reviewReason(unresolved.reason)}` +
          (claim?.sourceRefs?.length ? `；来源：${claim.sourceRefs.join('、')}` : '')
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
        kind: PANEL_STATUS[disposition.status] || 'Panel 状态未确定',
        nodes: disposition.nodeIds.map(label),
        detail: related.length ? `候选关系：${related.join('；')}`
          : disposition.reason ? `原因：${reviewReason(disposition.reason)}` : '未形成关系边'
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
            direction: 'LR', language: 'zh-CN', generatedRelationLabels: true
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
    for (const item of items) list.append(element('li', '', item));
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
      const source = element('td', 'mechanism-pending-preview-source', relation.sourceLabel);
      source.dataset.label = '上游节点';
      const nature = element('td', 'mechanism-pending-preview-nature', relation.nature);
      nature.dataset.label = '关系性质';
      const target = element('td', 'mechanism-pending-preview-target', relation.targetLabel);
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
            element('strong', 'mechanism-pending-preview-panel-key', evidence.panelKey),
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
            for (const sourceRef of evidence.sourceRefs) sourceList.append(element('li', '', sourceRef));
            sources.append(sourceList);
          }
          item.append(sources);
          list.append(item);
        }
        panels.append(list);
      }
      const context = element('td', 'mechanism-pending-preview-context', relation.context);
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
    section.dataset.previewStatus = model.status;
    section.dataset.canonicalDigest = model.canonicalDigest;
    const heading = element('header', 'mechanism-pending-preview-heading');
    heading.append(
      element('h3', '', options.title || '待核验预览（尚未替换已保存机制网络）'),
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
    if (model.mermaidDefinition) diagram.textContent = model.mermaidDefinition;
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
      `${node.label}（${({ entity: '生物实体', intervention: '干预', outcome: '结果',
        state: '状态', process: '过程' })[node.nodeType] || '机制节点'}）`), '没有可展示的候选节点。');
    graphSection.append(nodeRegion);
    section.append(graphSection, createEvidenceTable(model));

    const nonRelation = element('section',
      'workspace-mechanism-audit-region mechanism-pending-preview-nonrelation');
    const nonRelationDetails = element('details', 'mechanism-pending-preview-nonrelation-details');
    nonRelationDetails.append(element('summary', '',
      `未解析或无关系的 Panel 证据（${model.nonRelationEvidence.length}）`));
    appendList(nonRelationDetails, model.nonRelationEvidence.map(item => {
      const nodes = item.nodes.length ? `；节点：${item.nodes.join('、')}` : '';
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
