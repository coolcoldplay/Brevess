'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const M = require('../workbench/model.js');
const S = require('../core/research-workbench-model.js');
const { createAgentTools } = require('../workbench/agent-tools.js');
const { createGlobalLibraryReader, mergeGlobalLibrary } = require('../workbench/global-library.js');
const registry = require('../workbench/operation-registry.js');
const { createResearchWorkbenchStore, createMemoryResearchWorkbenchBackend } = require('../core/research-workbench-store.js');
const IO = require('../core/research-workbench-import-export.js');

function store() {
  return createResearchWorkbenchStore({ backend: createMemoryResearchWorkbenchBackend() });
}

function fixture() {
  const project = M.project('R36 测试课题', '测试素材拼图与证据块');
  const hypothesis = M.hypothesis('测试假说');
  const nodeA = { id: 'node-a', label: '节点 A', kind: 'bio', x: 0, y: 0, w: 190, h: 82 };
  const nodeB = { id: 'node-b', label: '节点 B', kind: 'bio', x: 300, y: 0, w: 190, h: 82 };
  const edge = { id: 'edge-a', source: nodeA.id, target: nodeB.id, claim: '联系', condition: '', status: 'pending', bindings: [] };
  hypothesis.nodes = [nodeA, nodeB];
  hypothesis.edges = [edge];
  project.hypotheses = [hypothesis];
  const plan = M.plan('测试方案');
  const figure = M.figure('Figure 1 · 测试');
  const panelA = M.panel('Panel A');
  const panelB = M.panel('Panel B');
  panelA.status = 'complete';
  panelB.status = 'complete';
  figure.panels = [panelA, panelB];
  plan.figures = [figure];
  plan.hypothesisIds = [hypothesis.id];
  project.plans = [plan];
  project.resources = [{
    id: 'paper-test', type: 'paper', title: '测试论文',
    source: { workspaceId: 'ws-test', workspaceGeneration: 1, relativePath: 'article/structure.json', resourceId: 'article', revision: 1, contentHash: 'hash-test' }
  }];
  return { project, hypothesis, nodeA, nodeB, edge, plan, figure, panelA, panelB };
}

function sessionFor(project, hypothesis) {
  const state = {
    row: { id: project.id, project, revision: 1 },
    selection: { selection: { projectId: project.id, mode: 'hypothesis', hypothesisId: hypothesis.id, planId: null, figureId: null } },
    undo: [], redo: [], proposal: null
  };
  return {
    state,
    async edit(label, fn) {
      const next = structuredClone(state.row.project);
      fn(next);
      S.wbValidateProject(next);
      state.row.project = next;
      state.row.revision += 1;
      return next;
    },
    async select(selection) { state.selection.selection = { ...state.selection.selection, ...selection }; return state.selection; },
    async saveEntityView() {},
    async open() {},
    async reload() {},
    async undo() {},
    async redo() {}
  };
}

test('new optional model fields survive validation and old projects remain readable', () => {
  const { project, hypothesis, edge, figure, panelA } = fixture();
  const old = structuredClone(project);
  delete old.materialLinks;
  delete old.plans[0].figures[0].evidenceBlocks;
  delete old.hypotheses[0].edges[0].kind;
  assert.doesNotThrow(() => S.wbValidateProject(old));

  project.materialLinks = [M.materialLink({
    targetType: 'edge', hypothesisId: hypothesis.id, targetId: edge.id,
    materialType: 'paper', sourceKind: 'library', resourceId: 'paper-test',
    sourceSnapshot: project.resources[0].source, stance: 'support', note: '支持测试'
  })];
  figure.evidenceBlocks = [M.evidenceBlock({ title: '证据块 E1', panelIds: [panelA.id], status: 'complete', summary: '逻辑分组' })];
  edge.kind = 'feedback';
  const validated = S.wbValidateProject(project);
  assert.equal(validated.materialLinks[0].stance, 'support');
  assert.equal(validated.plans[0].figures[0].evidenceBlocks[0].title, '证据块 E1');
  assert.equal(validated.hypotheses[0].edges[0].kind, 'feedback');
  assert.doesNotThrow(() => S.wbValidateProject(JSON.parse(JSON.stringify(validated))));
});

test('agent model operations attach material, update stance, create evidence block and edge kind', async () => {
  const { project, hypothesis, edge, plan, figure, panelA, panelB } = fixture();
  const session = sessionFor(project, hypothesis);
  const tools = createAgentTools({ session, adapter: { validateReference: async () => true }, projection: S });
  const execute = (operation, extra = {}) => tools.execute('model_operation', {
    expectedProjectId: project.id,
    expectedRevision: session.state.row.revision,
    operation,
    ...extra
  });

  const attached = await execute('attach_material', {
    hypothesisId: hypothesis.id, targetType: 'edge', targetId: edge.id,
    materialType: 'paper', sourceKind: 'library', resourceId: 'paper-test',
    stance: 'support', note: '支持联系'
  });
  assert.ok(attached.linkId);
  assert.equal(session.state.row.project.materialLinks.length, 1);
  assert.equal(session.state.row.project.materialLinks[0].stance, 'support');

  const repeated = await execute('attach_material', {
    hypothesisId: hypothesis.id, targetType: 'edge', targetId: edge.id,
    materialType: 'paper', sourceKind: 'library', resourceId: 'paper-test',
    stance: 'oppose'
  });
  assert.equal(repeated.idempotent, true);
  assert.equal(session.state.row.project.materialLinks.length, 1);

  await execute('update_material_stance', { linkId: attached.linkId, stance: 'oppose', note: '反对直接推断' });
  assert.equal(session.state.row.project.materialLinks[0].stance, 'oppose');

  const block = await execute('create_evidence_block', {
    planId: plan.id, figureId: figure.id, title: 'E1', panelIds: [panelA.id, panelB.id], status: 'complete'
  });
  assert.ok(block.blockId);
  assert.equal(session.state.row.project.plans[0].figures[0].evidenceBlocks.length, 1);

  const createdPanel = await execute('create_panel', {
    planId: plan.id,
    figureId: figure.id,
    title: 'Panel C',
    point: { x: 580, y: 0 },
    w: 300,
    h: 180,
    purpose: '验证目标机制',
    expectedResult: '信号下降',
    status: 'review'
  });
  const persistedPanel = session.state.row.project.plans[0].figures[0].panels
    .find(panel => panel.id === createdPanel.createdId);
  assert.equal(persistedPanel.purpose, '验证目标机制');
  assert.equal(persistedPanel.expectedResult, '信号下降');
  assert.equal(persistedPanel.status, 'review');
  assert.equal(persistedPanel.w, 300);
  assert.equal(persistedPanel.h, 180);

  await execute('set_edge_relation', { hypothesisId: hypothesis.id, edgeId: edge.id, kind: 'feedback' });
  assert.equal(session.state.row.project.hypotheses[0].edges[0].kind, 'feedback');
  assert.doesNotThrow(() => S.wbValidateProject(session.state.row.project));
});

test('operation registry includes open_local_pdf and routine write operations', () => {
  const names = registry.WORKBENCH_OPERATIONS.map(operation => operation.name);
  for (const name of [
    'open_local_pdf', 'query_global_library', 'create_project', 'create_hypothesis',
    'create_plan', 'create_figure', 'create_node', 'create_edge', 'create_panel',
    'layout', 'set_panel_status', 'attach_material', 'update_material_stance',
    'create_evidence_block', 'set_edge_relation'
  ]) {
    assert.ok(names.includes(name), `missing ${name}`);
  }
  assert.equal(registry.WORKBENCH_OPERATIONS.find(item => item.name === 'attach_material').approvalClass, 'routine_write');
  assert.equal(registry.WORKBENCH_OPERATIONS.find(item => item.name === 'open_local_pdf').approvalClass, 'human_os_picker');
  assert.equal(registry.WORKBENCH_OPERATIONS.find(item => item.name === 'create_project').approvalClass, 'human_confirm');
  assert.equal(registry.WORKBENCH_OPERATIONS.find(item => item.name === 'create_edge').inputSchema.properties.kind.enum.includes('feedback'), true);
  assert.ok(registry.WORKBENCH_OPERATIONS.find(item => item.name === 'create_panel').inputSchema.properties.purpose);
  assert.ok(registry.WORKBENCH_OPERATIONS.find(item => item.name === 'create_figure').inputSchema.properties.question);
});

test('global library merges local and radar read entries without fake workspaces', async () => {
  const local = {
    id: 'paper-local', title: 'Local paper', authors: 'A', journal: 'Journal', publicationDate: '2025',
    doi: '10.1000/test', sourceDocuments: [{ workspaceId: 'ws-1', workspaceGeneration: 1, hasOfflineSnapshot: true, offlineSnapshotStatus: 'complete' }]
  };
  const radarState = {
    radars: [{ id: 'radar-test', revisions: [{ number: 1, articles: [
      { id: '12345', title: 'Local paper', doi: '10.1000/test', journal: 'Journal', publicationDate: '2025', read: true },
      { id: '67890', title: 'Radar only paper', authors: [{ name: 'Ada Lovelace' }, { name: 'Rosalind Franklin' }], journal: 'Radar Journal', publicationDate: '2026', read: true }
    ] }] }]
  };
  const reader = createGlobalLibraryReader({
    adapter: { queryLibrary: async () => ({ items: [local], page: 1, pageCount: 1, matchedCount: 1 }) },
    radarStore: { read: async () => radarState }
  });
  const result = await reader.query({ page: 1, pageSize: 40 });
  assert.equal(result.items.length, 2);
  const merged = result.items.find(item => item.title === 'Local paper');
  assert.equal(merged.sourceKind, 'mixed');
  assert.equal(merged.availability, 'local');
  const radarOnly = result.items.find(item => item.title === 'Radar only paper');
  assert.equal(radarOnly.sourceKind, 'radar');
  assert.equal(radarOnly.availability, 'metadata-only');
  assert.equal(radarOnly.sourceDocuments.length, 0);
  assert.equal(radarOnly.authors, 'Ada Lovelace, Rosalind Franklin');
  assert.ok(!radarOnly.authors.includes('[object Object]'));
  assert.ok(radarOnly.stableId);
  assert.ok(merged.stableId);
});

test('global library scans every local page with the local search scope, filters, then paginates the merged view', async () => {
  const calls = [];
  const localRows = Array.from({ length: 5 }, (_, index) => ({
    id: `local-${index}`, title: `Local paper ${index}`, authors: 'A', journal: 'J', publicationDate: '2025',
    sourceDocuments: [{ workspaceId: `ws-${index}`, workspaceGeneration: 1, hasOfflineSnapshot: true, offlineSnapshotStatus: 'complete' }]
  }));
  const reader = createGlobalLibraryReader({
    adapter: {
      async queryLibrary(options) {
        calls.push(structuredClone(options));
        const start = (options.page - 1) * options.pageSize;
        return {
          items: localRows.slice(start, start + options.pageSize),
          page: options.page,
          pageCount: Math.ceil(localRows.length / options.pageSize),
          matchedCount: localRows.length
        };
      }
    },
    radarStore: {
      async read() {
        return {
          radars: [{ id: 'r', revisions: [{ number: 1, articles: [
            { id: '777', title: 'Radar only', read: true, journal: 'R', publicationDate: '2026' },
            { id: '888', title: 'Unread should stay out', read: false }
          ] }] }]
        };
      }
    }
  });
  const result = await reader.query({ page: 2, pageSize: 2, scope: 'all' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scope, 'all');
  assert.equal(calls[0].pageSize, 100);
  assert.equal(result.matchedCount, 6);
  assert.equal(result.pageCount, 3);
  assert.equal(result.page, 2);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every(item => !item.title.includes('Unread')));
});

test('formal export/import remaps material links and evidence blocks without changing stance or edge relation', async () => {
  const { project, hypothesis, edge, nodeB, figure, panelA, panelB } = fixture();
  project.materialLinks = [
    M.materialLink({
      targetType: 'edge', hypothesisId: hypothesis.id, targetId: edge.id,
      materialType: 'paper', sourceKind: 'library', resourceId: 'paper-test',
      sourceSnapshot: project.resources[0].source, stance: 'oppose', note: '与当前条件相反'
    }),
    M.materialLink({
      targetType: 'node', hypothesisId: hypothesis.id, targetId: nodeB.id,
      materialType: 'panel', sourceKind: 'plan', resourceId: panelA.id,
      stance: 'support', note: '自有 Panel 支持机制'
    })
  ];
  figure.evidenceBlocks = [M.evidenceBlock({ title: 'E1', panelIds: [panelA.id, panelB.id], summary: '逻辑分组', status: 'complete' })];
  edge.kind = 'feedback';
  const source = store();
  await source.saveProject(project, { expectedRevision: 0 });
  const bundle = await IO.exportResearchWorkbenchBundle(source);
  const target = store();
  const imported = await IO.importResearchWorkbenchBundle(target, bundle);
  const restored = imported.projects[0].project;
  const restoredHypothesis = restored.hypotheses[0];
  const restoredEdge = restoredHypothesis.edges[0];
  const restoredFigure = restored.plans[0].figures[0];
  const restoredPaper = restored.resources.find(resource => resource.originalId === 'paper-test');
  assert.equal(restoredEdge.kind, 'feedback');
  assert.equal(restored.materialLinks.length, 2);
  const paperLink = restored.materialLinks.find(link => link.sourceKind === 'library');
  const panelLink = restored.materialLinks.find(link => link.sourceKind === 'plan');
  assert.equal(paperLink.targetId, restoredEdge.id);
  assert.equal(paperLink.resourceId, restoredPaper.id);
  assert.equal(paperLink.stance, 'oppose');
  assert.equal(paperLink.note, '与当前条件相反');
  assert.equal(paperLink.sourceSnapshot.contentHash, 'hash-test');
  assert.ok(restoredHypothesis.nodes.some(node => node.id === panelLink.targetId));
  assert.ok(restoredFigure.panels.some(panel => panel.id === panelLink.resourceId));
  assert.equal(restoredFigure.evidenceBlocks.length, 1);
  assert.deepEqual(
    [...restoredFigure.evidenceBlocks[0].panelIds].sort(),
    restoredFigure.panels.map(panel => panel.id).sort()
  );
  assert.equal(restoredFigure.evidenceBlocks[0].summary, '逻辑分组');
});

