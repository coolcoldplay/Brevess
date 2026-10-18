(function (root, factory) {
  const common=typeof module==='object'&&module.exports;
  const api = factory(common?require('./research-workbench-group-table.js'):(root.SciLLM ||= {}));
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.SciLLM ||= {}, api);
})(globalThis, function (tables) {
  'use strict';
  const WORKBENCH_DATABASE_NAME = 'brevess-research-workbench';
  const WORKBENCH_DATABASE_VERSION = 1;
  const WORKBENCH_OPERATION_CONTRACT_VERSION = 1;
  const MATERIAL_TYPES = Object.freeze(['paper', 'figure', 'panel', 'evidence-block']);
  const MATERIAL_SOURCES = Object.freeze(['library', 'plan']);
  const MATERIAL_STANCES = Object.freeze(['support', 'oppose', 'neutral']);
  const EDGE_KINDS = Object.freeze(['main', 'branch', 'feedback']);
  const EVIDENCE_BLOCK_STATUSES = Object.freeze(['draft', 'complete']);
  function wbError(code, details) { return Object.assign(new Error(code), { code, details }); }
  const wbClone = value => structuredClone(value);
  function wbJson(value) {
    function visit(v) {
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (Array.isArray(v)) return v.map(visit);
      if (v && Object.getPrototypeOf(v) === Object.prototype) {
        return Object.fromEntries(Object.keys(v).sort().map(k => [k, visit(v[k])]));
      }
      throw wbError('WORKBENCH_INVALID_JSON');
    }
    return JSON.stringify(visit(value));
  }
  function wbId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw wbError('WORKBENCH_INVALID_ID');
    return value;
  }
  const wbNewId = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
  function wbValidateProject(project) {
    wbJson(project); wbId(project.id);
    const unique = list => { const ids = new Set(); for (const row of list) { wbId(row.id); if (ids.has(row.id)) throw wbError('WORKBENCH_DUPLICATE_ID'); ids.add(row.id); } };
    for (const field of ['hypotheses', 'plans', 'assets']) {
      if (!Array.isArray(project[field])) throw wbError('WORKBENCH_INVALID_PROJECT', { field });
      unique(project[field]);
    }
    for (const h of project.hypotheses) {
      if (!Array.isArray(h.nodes) || !Array.isArray(h.edges)) throw wbError('WORKBENCH_INVALID_HYPOTHESIS');
      unique(h.nodes); unique(h.edges);
      for (const edge of h.edges) if (!h.nodes.some(n => n.id === edge.source) || !h.nodes.some(n => n.id === edge.target)) throw wbError('WORKBENCH_DANGLING_EDGE');
      for (const edge of h.edges) if (edge.kind !== undefined && !EDGE_KINDS.includes(edge.kind)) throw wbError('WORKBENCH_EDGE_RELATION_INVALID', {field:'kind', edgeId:edge.id, allowedValues:[...EDGE_KINDS]});
    }
    const validateTables=(plan,path)=>{
      for(const [figureIndex,figure] of (Array.isArray(plan.figures)?plan.figures:[]).entries())for(const [panelIndex,panel] of (Array.isArray(figure?.panels)?figure.panels:[]).entries())if(panel&&typeof panel==='object'&&Object.hasOwn(panel,'groupTable')){
        const projectPath=path+'.figures.'+figureIndex+'.panels.'+panelIndex+'.groupTable';
        if(typeof tables?.validateWorkbenchGroupTable!=='function')throw wbError('WORKBENCH_GROUP_TABLE_CAPABILITY_UNAVAILABLE',{field:'groupTable',projectPath});
        try{tables.validateWorkbenchGroupTable(panel.groupTable);}catch(error){error.details={...error.details,projectPath,panelId:panel.id,figureId:figure.id,planId:plan.id};throw error;}
      }
      for(const [index,version] of (Array.isArray(plan.history)?plan.history:[]).entries())if(version?.snapshot&&typeof version.snapshot==='object')validateTables(version.snapshot,path+'.history.'+index+'.snapshot');
    };
    for (const [planIndex,plan] of project.plans.entries()) {
      if (!Array.isArray(plan.figures) || !Array.isArray(plan.hypothesisIds)) throw wbError('WORKBENCH_INVALID_PLAN');
      unique(plan.figures);
      for (const id of plan.hypothesisIds) if (!project.hypotheses.some(h => h.id === id)) throw wbError('WORKBENCH_DANGLING_HYPOTHESIS');
      for (const figure of plan.figures) {
        if (!Array.isArray(figure.panels)) throw wbError('WORKBENCH_INVALID_FIGURE'); unique(figure.panels);
        const blocks = figure.evidenceBlocks ?? [];
        if (!Array.isArray(blocks)) throw wbError('WORKBENCH_EVIDENCE_BLOCK_INVALID', {field:'evidenceBlocks', figureId:figure.id});
        unique(blocks);
        for (const block of blocks) {
          if (!EVIDENCE_BLOCK_STATUSES.includes(block.status ?? 'draft')) throw wbError('WORKBENCH_EVIDENCE_BLOCK_INVALID', {field:'status', blockId:block.id, allowedValues:[...EVIDENCE_BLOCK_STATUSES]});
          if (typeof block.title !== 'string' || !block.title.trim() || block.title.length > 500) throw wbError('WORKBENCH_EVIDENCE_BLOCK_INVALID', {field:'title', blockId:block.id});
          if (!Array.isArray(block.panelIds) || !block.panelIds.length || new Set(block.panelIds).size !== block.panelIds.length || block.panelIds.some(id => !figure.panels.some(panel => panel.id === id))) throw wbError('WORKBENCH_EVIDENCE_BLOCK_INVALID', {field:'panelIds', blockId:block.id});
          if (block.summary !== undefined && (typeof block.summary !== 'string' || block.summary.length > 4000)) throw wbError('WORKBENCH_EVIDENCE_BLOCK_INVALID', {field:'summary', blockId:block.id});
        }
      }
      validateTables(plan,'plans.'+planIndex);
    }
    const links = project.materialLinks ?? [];
    if (!Array.isArray(links)) throw wbError('WORKBENCH_MATERIAL_TYPE_INVALID', {field:'materialLinks'});
    unique(links);
    for (const link of links) {
      if (!['node', 'edge'].includes(link.targetType)) throw wbError('WORKBENCH_MATERIAL_TARGET_NOT_FOUND', {field:'targetType', linkId:link.id});
      if (!MATERIAL_TYPES.includes(link.materialType)) throw wbError('WORKBENCH_MATERIAL_TYPE_INVALID', {field:'materialType', linkId:link.id, allowedValues:[...MATERIAL_TYPES]});
      if (!MATERIAL_SOURCES.includes(link.sourceKind)) throw wbError('WORKBENCH_MATERIAL_TYPE_INVALID', {field:'sourceKind', linkId:link.id, allowedValues:[...MATERIAL_SOURCES]});
      if (!MATERIAL_STANCES.includes(link.stance ?? 'neutral')) throw wbError('WORKBENCH_MATERIAL_TYPE_INVALID', {field:'stance', linkId:link.id, allowedValues:[...MATERIAL_STANCES]});
      if (typeof link.resourceId !== 'string' || !link.resourceId) throw wbError('WORKBENCH_MATERIAL_SOURCE_REQUIRED', {field:'resourceId', linkId:link.id});
      if (link.note !== undefined && (typeof link.note !== 'string' || link.note.length > 4000)) throw wbError('WORKBENCH_MATERIAL_TYPE_INVALID', {field:'note', linkId:link.id});
      const hypothesis = project.hypotheses.find(h => h.id === link.hypothesisId);
      if (!hypothesis) throw wbError('WORKBENCH_MATERIAL_TARGET_NOT_FOUND', {field:'hypothesisId', linkId:link.id});
      const rows = link.targetType === 'node' ? hypothesis.nodes : hypothesis.edges;
      if (!rows.some(row => row.id === link.targetId)) throw wbError('WORKBENCH_MATERIAL_TARGET_NOT_FOUND', {field:'targetId', linkId:link.id});
    }
    return wbClone(project);
  }
  function wbScientificProjection(project) {
    const p = wbClone(project);
    delete p.lastView; delete p.view;
    const omit = (o, fields) => fields.forEach(k => delete o[k]);
    for (const h of p.hypotheses) {
      omit(h, ['view', 'revision']);
      for (const node of h.nodes) omit(node, ['x', 'y', 'w', 'h', 'width', 'height']);
      for (const edge of h.edges) omit(edge, ['sourcePort', 'targetPort', 'route', 'waypoints', 'labelPosition']);
    }
    for (const plan of p.plans) {
      omit(plan, ['view']);
      for (const figure of plan.figures) {
        omit(figure, ['view']);
        for (const panel of figure.panels) omit(panel, ['x', 'y', 'w', 'h', 'rotation', 'zIndex']);
      }
    }
    return p;
  }
  function wbLayoutProjection(project) {
    return {
      hypotheses: project.hypotheses.map(h => ({ id: h.id, nodes: h.nodes.map(n => Object.fromEntries(['id','x','y','w','h','width','height'].filter(k => Object.hasOwn(n,k)).map(k => [k,n[k]]))), edges: h.edges.map(e => Object.fromEntries(['id','sourcePort','targetPort','route','waypoints','labelPosition'].filter(k => Object.hasOwn(e,k)).map(k => [k,e[k]]))) })),
      plans: project.plans.map(p => ({ id:p.id, figures:p.figures.map(f => ({id:f.id,panels:f.panels.map(n => Object.fromEntries(['id','x','y','w','h','rotation','zIndex'].filter(k => Object.hasOwn(n,k)).map(k => [k,n[k]])))})) }))
    };
  }
  async function wbBytes(value) {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (typeof Blob !== 'undefined' && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    if (typeof value === 'string') return new TextEncoder().encode(value);
    throw wbError('WORKBENCH_INVALID_BINARY');
  }
  async function wbSha256(value) {
    const bytes = await wbBytes(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
  }
  return { WORKBENCH_DATABASE_NAME, WORKBENCH_DATABASE_VERSION, WORKBENCH_OPERATION_CONTRACT_VERSION,
    MATERIAL_TYPES, MATERIAL_SOURCES, MATERIAL_STANCES, EDGE_KINDS, EVIDENCE_BLOCK_STATUSES,
    wbError, wbClone, wbJson, wbId, wbNewId, wbValidateProject, wbScientificProjection, wbLayoutProjection, wbBytes, wbSha256 };
});
