(function(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(
    common ? require('./model.js') : root.Workbench,
    common ? require('../core/research-workbench-model.js') : root.SciLLM
  );
  if (common) module.exports = api;
  Object.assign(root.Workbench ||= {}, api);
})(globalThis, function(M, S) {
  'use strict';

  const WORKBENCH_SHARE_KIND = 'brevess-research-share-v1';
  const WORKBENCH_SHARE_SCHEMA_VERSION = 1;
  const WORKBENCH_SHARE_APP_VERSION = '1.0.1';
  const TYPES = Object.freeze(['hypothesis', 'plan', 'bundle']);
  const SENSITIVE_KEY = /^(?:token|accessToken|refreshToken|apiKey|api_key|authorization|password|secret|credential|credentials|privateKey)$/iu;
  const PATH_KEY = /(?:absolutePath|filePath|localPath|workspacePath|directoryPath|folderPath|rootPath|pdfPath|path)$/iu;

  const fault = (code, message, details) => Object.assign(new Error(message || code), { code, details });
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isAbsolutePath = value => typeof value === 'string' && (
    /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\/u.test(value) || /^file:\/\//iu.test(value) ||
    /^\/(?:Users|home|mnt|tmp|var|opt)\//u.test(value)
  );

  function sanitize(value, key = '') {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
      if (typeof value === 'string' && isAbsolutePath(value)) return '[local path omitted]';
      return value;
    }
    if (Array.isArray(value)) return value.map(item => sanitize(item));
    if (!isObject(value)) throw fault('SHARE_INVALID_JSON', '分享数据只能是 JSON');
    const output = {};
    for (const [childKey, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(childKey)) continue;
      if (['image', 'dataUrl', 'base64', 'bytes'].includes(childKey)) continue;
      if (PATH_KEY.test(childKey) && isAbsolutePath(child)) continue;
      if (/^file:\/\//iu.test(String(child || ''))) continue;
      output[childKey] = sanitize(child, childKey);
    }
    return output;
  }

  function scanUnsafe(value, path = [], issues = []) {
    if (typeof value === 'string') {
      if (isAbsolutePath(value)) issues.push({ path: path.join('.'), reason: 'absolute_path' });
      return issues;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => scanUnsafe(item, [...path, index], issues));
      return issues;
    }
    if (!isObject(value)) return issues;
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) issues.push({ path: [...path, key].join('.'), reason: 'sensitive_key' });
      if (['image', 'dataUrl', 'base64', 'bytes'].includes(key)) issues.push({ path: [...path, key].join('.'), reason: 'embedded_binary' });
      if (PATH_KEY.test(key) && isAbsolutePath(child)) issues.push({ path: [...path, key].join('.'), reason: 'absolute_path' });
      scanUnsafe(child, [...path, key], issues);
    }
    return issues;
  }

  function canon(value) {
    const copy = M.clone(value);
    delete copy.integrity;
    return S.wbJson(copy);
  }

  async function computeHash(value) {
    return S.wbSha256(canon(value));
  }

  function selectedIds(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(item => typeof item === 'string' && item))];
  }

  function collectPlanHypothesisIds(plan, materialLinks, target = new Set()) {
    for (const id of plan?.hypothesisIds || []) target.add(id);
    for (const figure of plan?.figures || []) for (const panel of figure.panels || []) {
      for (const link of panel.links || []) if (typeof link?.hypothesisId === 'string') target.add(link.hypothesisId);
    }
    const ownSources = new Set();
    for (const figure of plan?.figures || []) {
      for (const panel of figure.panels || []) ownSources.add(panel.id);
      for (const block of figure.evidenceBlocks || []) ownSources.add(block.id);
    }
    for (const link of materialLinks || []) if (link?.hypothesisId && ownSources.has(link.resourceId)) target.add(link.hypothesisId);
    return target;
  }

  function planIdsReferencedByHypotheses(hypotheses, links, plans) {
    const ids = new Set();
    const hypothesisIds = new Set(hypotheses.map(item => item.id));
    for (const link of links) {
      if (link?.sourceKind !== 'plan' || !hypothesisIds.has(link.hypothesisId)) continue;
      for (const plan of plans) {
        for (const figure of plan.figures || []) {
          if ((figure.panels || []).some(panel => panel.id === link.resourceId) ||
              (figure.evidenceBlocks || []).some(block => block.id === link.resourceId)) ids.add(plan.id);
        }
      }
    }
    return ids;
  }

  function collectLibraryRefs(value, target = new Set(), key = '') {
    if (!value || key === 'sourceSnapshot') return target;
    if (Array.isArray(value)) {
      if (key === 'papers') {
        for (const item of value) if (typeof item === 'string') target.add(item);
        return target;
      }
      for (const item of value) collectLibraryRefs(item, target);
      return target;
    }
    if (!isObject(value)) return target;
    for (const [childKey, child] of Object.entries(value)) {
      if (['resourceId', 'sourceResourceId'].includes(childKey) && typeof child === 'string') target.add(child);
      else collectLibraryRefs(child, target, childKey);
    }
    return target;
  }

  function collectAssetRefs(value, target = new Set()) {
    if (Array.isArray(value)) {
      for (const item of value) collectAssetRefs(item, target);
      return target;
    }
    if (!isObject(value)) return target;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'ownAssetId' && typeof child === 'string') target.add(child);
      else collectAssetRefs(child, target);
    }
    return target;
  }

  function warning(warnings, code, message, referenceId = null) {
    warnings.push({ code, message, ...(referenceId ? { referenceId } : {}) });
  }

  async function createShare(project, request = {}, options = {}) {
    if (!project) throw fault('SHARE_PROJECT_REQUIRED', '当前没有可分享的课题');
    const requestedHypotheses = selectedIds(request.hypothesisIds);
    const requestedPlans = selectedIds(request.planIds);
    if (!requestedHypotheses.length && !requestedPlans.length) throw fault('SHARE_SELECTION_EMPTY', '请选择至少一个假说或方案');
    for (const id of requestedHypotheses) if (!project.hypotheses.some(item => item.id === id)) throw fault('SHARE_ENTITY_NOT_FOUND', `找不到假说 ${id}`);
    for (const id of requestedPlans) if (!project.plans.some(item => item.id === id)) throw fault('SHARE_ENTITY_NOT_FOUND', `找不到方案 ${id}`);

    const includedHypothesisIds = new Set(requestedHypotheses);
    const includedPlanIds = new Set(requestedPlans);
    const allLinks = project.materialLinks || [];
    for (let changed = true; changed;) {
      changed = false;
      for (const plan of project.plans.filter(item => includedPlanIds.has(item.id))) {
        for (const id of collectPlanHypothesisIds(plan, allLinks)) {
          if (!includedHypothesisIds.has(id)) {
            includedHypothesisIds.add(id);
            changed = true;
          }
        }
      }
      const includedHypotheses = project.hypotheses.filter(item => includedHypothesisIds.has(item.id));
      for (const id of planIdsReferencedByHypotheses(includedHypotheses, allLinks, project.plans)) {
        if (!includedPlanIds.has(id)) {
          includedPlanIds.add(id);
          changed = true;
        }
      }
    }

    const hypotheses = project.hypotheses.filter(item => includedHypothesisIds.has(item.id));
    const plans = project.plans.filter(item => includedPlanIds.has(item.id));
    const materialLinks = allLinks.filter(link => includedHypothesisIds.has(link.hypothesisId) &&
      hypotheses.some(hypothesis => (link.targetType === 'node' ? hypothesis.nodes : hypothesis.edges).some(row => row.id === link.targetId)));
    const assetIds = collectAssetRefs(plans);
    const resourceIds = collectLibraryRefs({
      hypotheses,
      plans,
      materialLinks: materialLinks.filter(link => link.sourceKind !== 'plan')
    });
    const warnings = [];

    const resources = [];
    for (const id of resourceIds) {
      const row = (project.resources || []).find(item => item.id === id);
      if (row) resources.push(row);
      else warning(warnings, 'SHARE_RESOURCE_UNRESOLVED', '来源引用未在本课题解析', id);
    }
    const assets = [];
    for (const id of assetIds) {
      const row = (project.assets || []).find(item => item.id === id);
      if (row) assets.push(row);
      else warning(warnings, 'SHARE_ASSET_UNRESOLVED', '自有图片引用未在本课题解析', id);
    }

    const primaryHypothesis = requestedHypotheses.length > 0;
    const primaryPlan = requestedPlans.length > 0;
    const type = primaryHypothesis && primaryPlan ? 'bundle' : primaryPlan ? 'plan' : 'hypothesis';
    const payload = {
      hypotheses: sanitize(hypotheses),
      plans: sanitize(plans),
      materialLinks: sanitize(materialLinks),
      resources: sanitize(resources),
      assets: sanitize(assets.map(row => ({
        id: row.id,
        type: row.type,
        title: row.title,
        mimeType: row.mimeType,
        sha256: row.sha256,
        byteLength: row.byteLength,
        note: row.note,
        availability: row.availability || 'unavailable'
      })))
    };
    const share = {
      kind: WORKBENCH_SHARE_KIND,
      schemaVersion: WORKBENCH_SHARE_SCHEMA_VERSION,
      appVersion: String(options.appVersion || WORKBENCH_SHARE_APP_VERSION),
      type,
      exportedAt: new Date().toISOString(),
      project: sanitize({ name: project.name || '', question: project.question || '' }),
      payload,
      dependencies: {
        hypothesisIds: hypotheses.map(item => item.id),
        planIds: plans.map(item => item.id)
      },
      warnings
    };
    share.integrity = { algorithm: 'SHA-256', contentHash: await computeHash(share) };
    return share;
  }

  function parseShare(input) {
    let value = input;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { throw fault('SHARE_INVALID_JSON', '分享文件不是有效 JSON'); }
    }
    if (!isObject(value)) throw fault('SHARE_INVALID_JSON', '分享文件必须是对象');
    S.wbJson(value);
    return M.clone(value);
  }

  async function validateShare(input) {
    const share = parseShare(input);
    if (share.kind !== WORKBENCH_SHARE_KIND) throw fault('SHARE_KIND_UNSUPPORTED', '不是 BREVESS 研究工作台分享文件');
    if (share.schemaVersion !== WORKBENCH_SHARE_SCHEMA_VERSION) {
      throw fault('SHARE_SCHEMA_UNSUPPORTED', `不支持的分享版本 ${share.schemaVersion}`);
    }
    if (!TYPES.includes(share.type)) throw fault('SHARE_TYPE_INVALID', '分享类型无效');
    if (typeof share.exportedAt !== 'string' || Number.isNaN(Date.parse(share.exportedAt))) throw fault('SHARE_INVALID', '分享时间无效');
    if (!isObject(share.payload) || !Array.isArray(share.payload.hypotheses) || !Array.isArray(share.payload.plans) ||
        !Array.isArray(share.payload.materialLinks) || !Array.isArray(share.payload.resources) || !Array.isArray(share.payload.assets)) {
      throw fault('SHARE_INVALID', '分享内容结构无效');
    }
    if (!share.integrity || share.integrity.algorithm !== 'SHA-256' || typeof share.integrity.contentHash !== 'string') {
      throw fault('SHARE_INTEGRITY_REQUIRED', '分享文件缺少完整性校验');
    }
    if (await computeHash(share) !== share.integrity.contentHash) throw fault('SHARE_INTEGRITY_MISMATCH', '分享文件内容与校验值不一致');
    const issues = scanUnsafe(share);
    if (issues.length) throw fault('SHARE_UNSAFE_REFERENCE', '分享文件包含绝对路径、密钥或内嵌二进制', { issues });
    buildProjectFromShare(share);
    return share;
  }

  function collectPlanResourceIds(plans, target = new Map()) {
    for (const plan of plans || []) for (const figure of plan.figures || []) {
      for (const panel of figure.panels || []) if (!target.has(panel.id)) target.set(panel.id, plan.id);
      for (const block of figure.evidenceBlocks || []) if (!target.has(block.id)) target.set(block.id, plan.id);
    }
    return target;
  }

  function applyShare(target, share) {
    const warnings = [];
    const idMap = {
      hypotheses: new Map(), nodes: new Map(), edges: new Map(), plans: new Map(), figures: new Map(),
      panels: new Map(), evidenceBlocks: new Map(), assets: new Map(), resources: new Map(), bindings: new Map(), materialLinks: new Map()
    };
    const assets = (share.payload.assets || []).map(row => {
      const id = M.uid('asset');
      idMap.assets.set(row.id, id);
      return { ...M.clone(row), id, originalId: row.id, availability: row.availability || 'unavailable' };
    });
    const assetsByOriginal = new Map(assets.map(row => [row.originalId, row]));
    const resources = (share.payload.resources || []).map(row => {
      const id = M.uid('source');
      idMap.resources.set(row.id, id);
      return { ...M.clone(row), id, originalId: row.id };
    });
    const resourcesByOriginal = new Map(resources.map(row => [row.originalId, row]));

    const libraryRefs = collectLibraryRefs({
      hypotheses: share.payload.hypotheses,
      plans: share.payload.plans,
      materialLinks: (share.payload.materialLinks || []).filter(link => link.sourceKind !== 'plan')
    });
    for (const originalId of libraryRefs) {
      if (resourcesByOriginal.has(originalId) || idMap.assets.has(originalId)) continue;
      const id = M.uid('source');
      idMap.resources.set(originalId, id);
      const placeholder = {
        id, originalId, type: 'reference', title: null, availability: 'unavailable',
        provenance: { kind: 'shared-reference' }
      };
      resources.push(placeholder);
      resourcesByOriginal.set(originalId, placeholder);
      warning(warnings, 'SHARE_RESOURCE_UNRESOLVED', '分享文件未包含该来源，已保留为不可用引用', originalId);
    }

    const hypothesisSources = share.payload.hypotheses || [];
    const planSources = share.payload.plans || [];
    for (const hypothesis of hypothesisSources) idMap.hypotheses.set(hypothesis.id, M.uid('hypothesis'));
    for (const plan of planSources) idMap.plans.set(plan.id, M.uid('plan'));
    for (const hypothesis of hypothesisSources) {
      const nodeMap = new Map(), edgeMap = new Map();
      for (const node of hypothesis.nodes || []) nodeMap.set(node.id, M.uid('node'));
      for (const edge of hypothesis.edges || []) edgeMap.set(edge.id, M.uid('edge'));
      idMap.nodes.set(hypothesis.id, nodeMap);
      idMap.edges.set(hypothesis.id, edgeMap);
    }
    for (const plan of planSources) {
      const figureMap = new Map(), panelMaps = new Map(), blockMap = new Map();
      for (const figure of plan.figures || []) {
        figureMap.set(figure.id, M.uid('figure'));
        const panelMap = new Map();
        for (const panel of figure.panels || []) panelMap.set(panel.id, M.uid('panel'));
        for (const block of figure.evidenceBlocks || []) blockMap.set(block.id, M.uid('evidence-block'));
        panelMaps.set(figure.id, panelMap);
      }
      idMap.figures.set(plan.id, figureMap);
      idMap.panels.set(plan.id, panelMaps);
      idMap.evidenceBlocks.set(plan.id, blockMap);
    }
    const planResourceMap = new Map();
    for (const plan of planSources) {
      for (const figure of plan.figures || []) {
        const panelMap = idMap.panels.get(plan.id)?.get(figure.id) || new Map();
        const blockMap = idMap.evidenceBlocks.get(plan.id) || new Map();
        for (const panel of figure.panels || []) planResourceMap.set(panel.id, panelMap.get(panel.id));
        for (const block of figure.evidenceBlocks || []) planResourceMap.set(block.id, blockMap.get(block.id));
      }
    }
    const resourceId = id => resourcesByOriginal.get(id)?.id || idMap.assets.get(id) || idMap.resources.get(id) || id;
    const assetId = id => idMap.assets.get(id) || id;
    const nodeId = (hypothesisId, id) => idMap.nodes.get(hypothesisId)?.get(id) || id;
    const edgeId = (hypothesisId, id) => idMap.edges.get(hypothesisId)?.get(id) || id;
    const mapPlanSource = id => planResourceMap.get(id) || (() => {
      warning(warnings, 'SHARE_PLAN_SOURCE_UNRESOLVED', '组图来源未包含在当前分享包中', id);
      return id;
    })();

    const hypotheses = hypothesisSources.map(source => {
      const hypothesis = M.clone(source);
      hypothesis.id = idMap.hypotheses.get(source.id);
      hypothesis.nodes = (source.nodes || []).map(node => ({
        ...M.clone(node),
        id: nodeId(source.id, node.id),
        ...(node.resourceId ? { resourceId: resourceId(node.resourceId) } : {}),
        ...(node.sourceResourceId ? { sourceResourceId: resourceId(node.sourceResourceId) } : {})
      }));
      hypothesis.edges = (source.edges || []).map(edge => {
        const next = M.clone(edge);
        next.id = edgeId(source.id, edge.id);
        next.source = nodeId(source.id, edge.source);
        next.target = nodeId(source.id, edge.target);
        next.papers = (edge.papers || []).map(resourceId);
        next.bindings = (edge.bindings || []).map(binding => {
          const id = M.uid('binding');
          if (binding.id) idMap.bindings.set(binding.id, id);
          return { ...M.clone(binding), id, ...(binding.resourceId ? { resourceId: resourceId(binding.resourceId) } : {}) };
        });
        if (edge.sourceResourceId) next.sourceResourceId = resourceId(edge.sourceResourceId);
        return next;
      });
      if (hypothesis.view?.selection) hypothesis.view.selection = hypothesis.view.selection.map(id =>
        idMap.nodes.get(source.id)?.get(id) || idMap.edges.get(source.id)?.get(id) || id
      );
      return hypothesis;
    });

    const plans = planSources.map(source => {
      const plan = M.clone(source);
      plan.id = idMap.plans.get(source.id);
      plan.hypothesisIds = (source.hypothesisIds || []).map(id => idMap.hypotheses.get(id)).filter(Boolean);
      plan.references = (source.references || []).map(ref => ({ ...M.clone(ref), ...(ref.resourceId ? { resourceId: resourceId(ref.resourceId) } : {}) }));
      plan.figures = (source.figures || []).map(sourceFigure => {
        const figure = M.clone(sourceFigure);
        figure.id = idMap.figures.get(source.id)?.get(sourceFigure.id);
        const panelMap = idMap.panels.get(source.id)?.get(sourceFigure.id) || new Map();
        const blockMap = idMap.evidenceBlocks.get(source.id) || new Map();
        figure.panels = (sourceFigure.panels || []).map(panel => {
          const next = M.clone(panel);
          next.id = panelMap.get(panel.id);
          if (panel.ownAssetId) next.ownAssetId = assetId(panel.ownAssetId);
          next.references = (panel.references || []).map(ref => ({ ...M.clone(ref), ...(ref.resourceId ? { resourceId: resourceId(ref.resourceId) } : {}) }));
          next.links = (panel.links || []).map(link => {
            const hypothesisId = idMap.hypotheses.get(link.hypothesisId);
            const mappedEdgeId = idMap.edges.get(link.hypothesisId)?.get(link.edgeId);
            if (!hypothesisId || !mappedEdgeId) {
              warning(warnings, 'SHARE_PLAN_LINK_UNRESOLVED', 'Panel 关联假说未包含在当前分享包中', link.hypothesisId);
              return null;
            }
            return { ...M.clone(link), hypothesisId, edgeId: mappedEdgeId };
          }).filter(Boolean);
          return next;
        });
        figure.evidenceBlocks = (sourceFigure.evidenceBlocks || []).map(block => ({
          ...M.clone(block),
          id: blockMap.get(block.id),
          panelIds: (block.panelIds || []).map(id => panelMap.get(id)).filter(Boolean)
        }));
        if (figure.view?.selection) figure.view.selection = figure.view.selection.map(id => panelMap.get(id) || id);
        return figure;
      });
      plan.history = [];
      if ((source.history || []).length) warning(warnings, 'SHARE_PLAN_HISTORY_EXCLUDED', '方案历史版本未包含在分享文件中', source.id);
      if (plan.view) {
        plan.view.figureId = idMap.figures.get(source.id)?.get(plan.view.figureId) || null;
        if (plan.view.selection) plan.view.selection = plan.view.selection.map(id => {
          for (const map of idMap.panels.get(source.id)?.values() || []) if (map.has(id)) return map.get(id);
          return idMap.figures.get(source.id)?.get(id) || id;
        });
      }
      return plan;
    });

    const materialLinks = (share.payload.materialLinks || []).map(link => {
      const hypothesisId = idMap.hypotheses.get(link.hypothesisId);
      if (!hypothesisId) return null;
      const targetId = link.targetType === 'node' ? nodeId(link.hypothesisId, link.targetId) : edgeId(link.hypothesisId, link.targetId);
      const next = M.clone(link);
      next.id = M.uid('material-link');
      next.hypothesisId = hypothesisId;
      next.targetId = targetId;
      next.resourceId = link.sourceKind === 'plan' ? mapPlanSource(link.resourceId) : resourceId(link.resourceId);
      return next;
    }).filter(Boolean);

    target.assets.push(...assets);
    target.resources.push(...resources);
    target.hypotheses.push(...hypotheses);
    target.plans.push(...plans);
    target.materialLinks ||= [];
    target.materialLinks.push(...materialLinks);
    S.wbValidateProject(target);
    return {
      project: target,
      warnings,
      idMap,
      created: {
        hypothesisIds: hypotheses.map(item => item.id),
        planIds: plans.map(item => item.id),
        nodeIds: hypotheses.flatMap(item => item.nodes.map(node => node.id)),
        edgeIds: hypotheses.flatMap(item => item.edges.map(edge => edge.id)),
        figureIds: plans.flatMap(item => item.figures.map(figure => figure.id)),
        panelIds: plans.flatMap(item => item.figures.flatMap(figure => figure.panels.map(panel => panel.id))),
        evidenceBlockIds: plans.flatMap(item => item.figures.flatMap(figure => (figure.evidenceBlocks || []).map(block => block.id))),
        materialLinkIds: materialLinks.map(item => item.id)
      }
    };
  }

  function mergeShareIntoProject(target, share) {
    if (!target) throw fault('SHARE_PROJECT_REQUIRED', '没有可接收分享的课题');
    const next = M.clone(target);
    return applyShare(next, share);
  }

  function buildProjectFromShare(share) {
    const project = M.project(share.project?.name || '导入的分享', share.project?.question || '');
    return applyShare(project, share);
  }

  async function importShare(session, input, { destination = 'current' } = {}) {
    const share = await validateShare(input);
    if (destination === 'current') {
      if (!session?.state?.row?.id) throw fault('SHARE_CURRENT_PROJECT_REQUIRED', '当前没有可接收分享的课题');
      let merged;
      await session.edit('导入研究分享', project => {
        merged = mergeShareIntoProject(project, share);
        Object.assign(project, merged.project);
      });
      return { destination, projectId: session.state.row.id, created: merged.created, warnings: merged.warnings };
    }
    if (destination !== 'new') throw fault('SHARE_DESTINATION_INVALID', '导入目标无效');
    const built = buildProjectFromShare(share);
    const row = await session.create(built.project);
    return { destination, projectId: row.id, created: built.created, warnings: built.warnings };
  }

  function shareFileName(type, date = new Date()) {
    const stamp = date.toISOString().replace(/[:.]/gu, '-');
    return `BREVESS-share-${type}-${stamp}.json`;
  }

  return {
    WORKBENCH_SHARE_KIND,
    WORKBENCH_SHARE_SCHEMA_VERSION,
    WORKBENCH_SHARE_APP_VERSION,
    createShare,
    validateShare,
    mergeShareIntoProject,
    buildProjectFromShare,
    importShare,
    shareFileName,
    sanitize
  };
});
