'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const M = require('../workbench/model.js');
const S = require('../core/research-workbench-model.js');
const { createSession } = require('../workbench/session.js');
const { createResearchWorkbenchStore, createMemoryResearchWorkbenchBackend } = require('../core/research-workbench-store.js');
const SHARE = require('../workbench/share.js');

function setup() {
  const store = createResearchWorkbenchStore({ backend: createMemoryResearchWorkbenchBackend() });
  return { store, session: createSession(store) };
}

function fixture() {
  const project = M.project('分享测试课题', '分支与反馈如何分享？');
  const res = {
    id: 'res-1', type: 'paper', title: '测试论文',
    availability: 'local', note: '人工备注',
    source: {
      workspaceId: 'ws-1', workspaceGeneration: 2, relativePath: 'article/structure.json',
      revision: 4, contentHash: 'hash-res-1', absolutePath: 'C:\\private\\paper.pdf', apiKey: 'super-secret'
    }
  };
  const asset = {
    id: 'asset-1', type: 'asset', title: '自己的图', mimeType: 'image/png',
    sha256: 'a'.repeat(64), byteLength: 12, note: '人工图片备注', image: 'data:image/png;base64,AAAA'
  };
  const h1 = M.hypothesis('H1 · 反馈机制');
  const n1 = { id: 'n1', label: '上游', kind: 'bio', x: 0, y: 0, w: 190, h: 82, resourceId: res.id, manual: { condition: '人工条件' } };
  const n2 = { id: 'n2', label: '下游', kind: 'bio', x: 340, y: 0, w: 190, h: 82 };
  const edge = {
    id: 'e1', source: n1.id, target: n2.id, claim: '人工判断', condition: '人工适用条件',
    kind: 'feedback', status: 'tested', manual: { note: '不可覆盖' }, bindings: [{
      id: 'binding-1', resourceId: res.id, types: ['necessary'], judgement: '人工证据判断', contrary: true,
      sourceSnapshot: { workspaceId: 'ws-1', workspaceGeneration: 2, relativePath: 'article/structure.json', workspacePath: 'D:\\private\\snapshot.json' }
    }]
  };
  h1.nodes = [n1, n2];
  h1.edges = [edge];
  h1.papers = [res.id];
  h1.revision = 3;
  h1.manual = { reviewer: '本人', keep: null };
  const h2 = M.hypothesis('H2 · 对照');
  h2.id = 'h2-static';
  h2.nodes = [{ id: 'n3', label: '对照节点', kind: 'bio', x: 0, y: 0, w: 190, h: 82 }];
  const plan = M.plan('方案 A · 反馈组图');
  const figure = M.figure('Figure 1 · 反馈');
  const panel = M.panel('Panel A', { x: 20, y: 20 });
  panel.status = 'complete';
  panel.result = '人工结果';
  panel.ownAssetId = asset.id;
  panel.references = [{ resourceId: res.id, note: '人工参考备注', borrow: '展示方式', sourceSnapshot: { workspaceId: 'ws-1', workspaceGeneration: 2, relativePath: 'article/structure.json', filePath: '/home/private/a.json' } }];
  panel.links = [{ hypothesisId: h1.id, edgeId: edge.id, revision: 3, role: 'test', needsReview: false }];
  const block = M.evidenceBlock({ title: '证据块 E1', panelIds: [panel.id], summary: '人工摘要', status: 'complete' });
  figure.panels = [panel];
  figure.evidenceBlocks = [block];
  figure.manual = { keep: null, note: '保留 Figure 人工字段' };
  plan.figures = [figure];
  plan.hypothesisIds = [h1.id];
  plan.references = [{ resourceId: res.id, note: '方案参考' }];
  plan.history = [{ name: '旧版本', snapshot: M.clone(plan) }];
  plan.view = { figureId: figure.id, selection: [panel.id] };
  const plan2 = M.plan('方案 B · 对照');
  plan2.hypothesisIds = [h2.id];
  project.hypotheses = [h1, h2];
  project.plans = [plan, plan2];
  project.resources = [res];
  project.assets = [asset];
  project.materialLinks = [
    M.materialLink({
      targetType: 'edge', hypothesisId: h1.id, targetId: edge.id, materialType: 'paper',
      sourceKind: 'library', resourceId: res.id, sourceSnapshot: res.source, stance: 'support', note: '人工支持备注'
    }),
    M.materialLink({
      targetType: 'edge', hypothesisId: h1.id, targetId: edge.id, materialType: 'evidence-block',
      sourceKind: 'plan', resourceId: block.id, stance: 'oppose', note: '内部证据反对备注'
    })
  ];
  return { project, h1, h2, plan, plan2, figure, panel, block, asset, res };
}

async function seal(value) {
  const share = M.clone(value);
  delete share.integrity;
  share.integrity = { algorithm: 'SHA-256', contentHash: await S.wbSha256(S.wbJson(share)) };
  return share;
}

test('share supports single, multi-select, plan and mixed bundle with version and integrity metadata', async () => {
  const { project, h1, h2, plan, plan2 } = fixture();
  const single = await SHARE.createShare(project, { hypothesisIds: [h1.id] }, { appVersion: 'test-app' });
  assert.equal(single.kind, 'brevess-research-share-v1');
  assert.equal(single.schemaVersion, 1);
  assert.equal(single.appVersion, 'test-app');
  assert.equal(single.type, 'hypothesis');
  assert.equal(single.payload.hypotheses.length, 1);
  assert.ok(single.payload.plans.some(item => item.id === plan.id), 'plan dependency must be included');
  assert.equal(single.integrity.algorithm, 'SHA-256');
  assert.ok(single.integrity.contentHash);

  const multi = await SHARE.createShare(project, { hypothesisIds: [h1.id, h2.id] });
  assert.equal(multi.type, 'hypothesis');
  assert.equal(multi.payload.hypotheses.length, 2);
  const planOnly = await SHARE.createShare(project, { planIds: [plan.id] });
  assert.equal(planOnly.type, 'plan');
  assert.ok(planOnly.payload.hypotheses.some(item => item.id === h1.id));
  const bundle = await SHARE.createShare(project, { hypothesisIds: [h1.id], planIds: [plan2.id] });
  assert.equal(bundle.type, 'bundle');
  assert.ok(bundle.payload.hypotheses.length >= 1);
  assert.ok(bundle.payload.plans.length >= 1);

  const serialized = JSON.stringify(single);
  assert.ok(!serialized.includes('C:\\\\private'));
  assert.ok(!serialized.includes('super-secret'));
  assert.ok(!serialized.includes('D:\\\\private'));
  assert.ok(!serialized.includes('data:image'));
  assert.ok(serialized.includes('article/structure.json'));
});

test('share roundtrip remaps every entity and preserves manual fields, edge kind, snapshots and unresolved warnings', async () => {
  const { project, h1, plan, block, panel } = fixture();
  const originalEdge = h1.edges[0];
  const share = await SHARE.createShare(project, { hypothesisIds: [h1.id], planIds: [plan.id] });
  const validated = await SHARE.validateShare(JSON.stringify(share));
  const built = SHARE.buildProjectFromShare(validated);
  const restoredH = built.project.hypotheses.find(item => item.name === h1.name);
  const restoredPlan = built.project.plans.find(item => item.name === plan.name);
  assert.ok(restoredH);
  assert.ok(restoredPlan);
  assert.notEqual(restoredH.id, h1.id);
  assert.notEqual(restoredH.nodes[0].id, h1.nodes[0].id);
  assert.notEqual(restoredH.edges[0].id, originalEdge.id);
  assert.notEqual(restoredPlan.id, plan.id);
  assert.notEqual(restoredPlan.figures[0].id, plan.figures[0].id);
  assert.notEqual(restoredPlan.figures[0].panels[0].id, panel.id);
  assert.notEqual(restoredPlan.figures[0].evidenceBlocks[0].id, block.id);
  assert.equal(restoredH.edges[0].kind, 'feedback');
  assert.equal(restoredH.edges[0].manual.note, '不可覆盖');
  assert.equal(restoredH.nodes[0].manual.condition, '人工条件');
  assert.equal(restoredH.edges[0].bindings[0].judgement, '人工证据判断');
  assert.equal(restoredH.edges[0].bindings[0].sourceSnapshot.relativePath, 'article/structure.json');
  assert.equal(restoredPlan.figures[0].manual.note, '保留 Figure 人工字段');
  assert.equal(restoredPlan.figures[0].panels[0].result, '人工结果');
  assert.equal(restoredPlan.figures[0].panels[0].references[0].note, '人工参考备注');
  assert.equal(restoredPlan.figures[0].evidenceBlocks[0].summary, '人工摘要');
  assert.ok(restoredPlan.figures[0].panels[0].ownAssetId);
  assert.notEqual(restoredPlan.figures[0].panels[0].ownAssetId, 'asset-1');
  assert.ok(restoredPlan.figures[0].panels[0].links[0].edgeId);
  assert.equal(restoredPlan.history.length, 0);
  assert.ok(built.warnings.some(item => item.code === 'SHARE_PLAN_HISTORY_EXCLUDED'));
});

test('current-project import appends fresh IDs, preserves existing content and is undoable', async () => {
  const { project, h1 } = fixture();
  const { store, session } = setup();
  await session.init();
  await session.create(project);
  const share = await SHARE.createShare(project, { hypothesisIds: [h1.id], planIds: [project.plans[0].id] });
  const before = JSON.stringify(session.state.row.project);
  const first = await SHARE.importShare(session, share, { destination: 'current' });
  const afterFirst = session.state.row.project;
  assert.equal(first.destination, 'current');
  assert.ok(afterFirst.hypotheses.length > project.hypotheses.length);
  assert.ok(afterFirst.plans.length > project.plans.length);
  assert.notEqual(first.created.hypothesisIds[0], h1.id);
  const firstIds = first.created.hypothesisIds;
  const second = await SHARE.importShare(session, share, { destination: 'current' });
  assert.notDeepEqual(second.created.hypothesisIds, firstIds);
  assert.ok(second.created.materialLinkIds.every(id => !afterFirst.materialLinks.some(link => link.id === id)));
  await session.undo();
  assert.equal(session.state.row.project.hypotheses.length, afterFirst.hypotheses.length);
  await session.undo();
  assert.deepEqual(JSON.parse(JSON.stringify(session.state.row.project)), JSON.parse(before));
});

test('new-project import is isolated from the current project and retains an unavailable-source warning', async () => {
  const { project, h1, res } = fixture();
  const { session } = setup();
  await session.init();
  await session.create(project);
  const share = await SHARE.createShare(project, { hypothesisIds: [h1.id] });
  share.payload.resources = [];
  const sealed = await seal(share);
  const beforeProjects = (await session.store.listProjects()).length;
  const imported = await SHARE.importShare(session, sealed, { destination: 'new' });
  assert.equal(imported.destination, 'new');
  assert.equal((await session.store.listProjects()).length, beforeProjects + 1);
  assert.ok(imported.warnings.some(item => item.code === 'SHARE_RESOURCE_UNRESOLVED'));
  assert.equal(session.state.row.project.name, project.name);
  assert.ok(session.state.row.project.resources.some(item => item.availability === 'unavailable' || item.provenance?.kind === 'shared-reference'));
  assert.ok(session.state.row.project.hypotheses.some(item => item.name === h1.name));
  assert.ok(res.id);
});

test('old, tampered, malformed and unsafe files fail before any write', async () => {
  const { project, h1 } = fixture();
  const { session } = setup();
  await session.init();
  await session.create(project);
  const before = JSON.stringify(session.state.row.project);
  const share = await SHARE.createShare(project, { hypothesisIds: [h1.id] });
  const old = M.clone(share);
  old.schemaVersion = 0;
  await assert.rejects(() => SHARE.validateShare(old), { code: 'SHARE_SCHEMA_UNSUPPORTED' });
  const tampered = M.clone(share);
  tampered.payload.hypotheses[0].name = '被篡改';
  await assert.rejects(() => SHARE.validateShare(tampered), { code: 'SHARE_INTEGRITY_MISMATCH' });
  await assert.rejects(() => SHARE.validateShare('{bad json'), { code: 'SHARE_INVALID_JSON' });
  const unsafe = M.clone(share);
  unsafe.payload.hypotheses[0].absolutePath = 'C:\\secret\\x';
  const unsafeSealed = await seal(unsafe);
  await assert.rejects(() => SHARE.validateShare(unsafeSealed), { code: 'SHARE_UNSAFE_REFERENCE' });
  await assert.rejects(() => SHARE.importShare(session, unsafeSealed, { destination: 'current' }), { code: 'SHARE_UNSAFE_REFERENCE' });
  assert.equal(JSON.stringify(session.state.row.project), before);
});
