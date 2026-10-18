/* Transport-neutral Workbench operation registry.
 *
 * This file is intentionally independent of an open session or IndexedDB.
 * MCP can read it for tools/list; actual execution remains in Workbench.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessWorkbenchOperations = Object.assign(root.BrevessWorkbenchOperations || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WORKBENCH_OPERATION_CONTRACT_VERSION = 1;
  const id = { type: 'string', minLength: 1, maxLength: 160 };
  const point = {
    type: 'object',
    properties: {
      x: { type: 'number' },
      y: { type: 'number' }
    },
    required: ['x', 'y'],
    additionalProperties: false
  };
  const guard = {
    expectedProjectId: id,
    expectedRevision: { type: 'integer', minimum: 0 }
  };
  const materialType = { enum: ['paper', 'figure', 'panel', 'evidence-block'] };
  const sourceKind = { enum: ['library', 'plan'] };
  const stance = { enum: ['support', 'oppose', 'neutral'], default: 'neutral' };
  const note = { type: 'string', maxLength: 4000 };
  const sourceSnapshot = {
    type: ['object', 'null'],
    properties: {
      workspaceId: { type: 'string' },
      workspaceGeneration: { type: 'integer', minimum: 1 },
      revision: { type: 'integer', minimum: 0 },
      contentHash: { type: 'string' }
    },
    additionalProperties: true
  };
  const operations = [
    {
      name: 'open_local_pdf',
      description: '请求宿主以只读方式打开本地 PDF，并返回真实解析或 PENDING_HOST_HOOK/PENDING_HUMAN_ACTION；Workbench 不伪造解析结果。',
      access: 'read',
      approvalClass: 'human_os_picker',
      requiredScopes: ['workbench:read'],
      version: 1,
      idempotency: 'read-only host hook',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', minLength: 1, maxLength: 4000 } },
        required: ['path'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          doi: { type: 'string' },
          pages: { type: 'integer' },
          referenceCount: { type: 'integer' },
          abstract: { type: 'string' },
          sourceKind: { type: 'string' },
          availability: { type: 'string' },
          receipt: { type: 'object' }
        },
        additionalProperties: true
      }
    },
    {
      name: 'query_global_library',
      description: '读取本地文献总库，并按 DOI/PMID/规范化标题合并雷达 read:true 的只读条目。',
      access: 'read',
      approvalClass: 'none',
      requiredScopes: ['workbench:read'],
      version: 1,
      idempotency: 'read-only',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 40 },
          query: { type: 'string', maxLength: 4000 },
          scope: { type: 'string', maxLength: 80 },
          tags: { type: 'array', items: { type: 'string' }, maxItems: 32 },
          tagMode: { enum: ['any', 'all'], default: 'any' },
          includeRadarRead: { type: 'boolean', default: true }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          items: { type: 'array' },
          page: { type: 'integer' },
          pageCount: { type: 'integer' },
          matchedCount: { type: 'integer' },
          sources: { type: 'object' },
          warnings: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: true
      }
    },
    {
      name: 'create_project',
      description: '空工作区的唯一 bootstrap 写操作。必须由真人一次性确认；expectedProjectId 必须为 null、expectedRevision 必须为 0，创建后重新读取真实 projectId/revision。',
      access: 'write',
      approvalClass: 'human_confirm',
      requiredScopes: ['workbench:bootstrap'],
      version: 1,
      idempotency: 'one-time bootstrap scope; no project ID may be invented',
      inputSchema: {
        type: 'object',
        properties: {
          expectedProjectId: { type: 'null' },
          expectedRevision: { type: 'integer', enum: [0] },
          name: { type: 'string', minLength: 1, maxLength: 500 },
          question: { type: 'string', maxLength: 4000 }
        },
        required: ['expectedProjectId', 'expectedRevision', 'name'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          createdId: id,
          projectId: id,
          revision: { type: 'integer', minimum: 0 }
        },
        additionalProperties: true
      }
    },
    {
      name: 'create_hypothesis',
      description: '在当前课题创建一条可包含分支与反馈的假说图。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'not idempotent',
      inputSchema: {
        type: 'object',
        properties: { ...guard, name: { type: 'string', minLength: 1, maxLength: 500 } },
        required: ['expectedProjectId', 'expectedRevision', 'name'],
        additionalProperties: false
      },
      outputSchema: { type: 'object', properties: { createdId: id, revision: { type: 'integer' } }, additionalProperties: true }
    },
    {
      name: 'create_plan',
      description: '在当前课题创建组图方案。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'not idempotent',
      inputSchema: {
        type: 'object',
        properties: { ...guard, name: { type: 'string', minLength: 1, maxLength: 500 } },
        required: ['expectedProjectId', 'expectedRevision', 'name'],
        additionalProperties: false
      },
      outputSchema: { type: 'object', properties: { createdId: id, revision: { type: 'integer' } }, additionalProperties: true }
    },
    {
      name: 'create_figure',
      description: '在组图方案中创建一张 Figure。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'not idempotent',
      inputSchema: {
        type: 'object',
        properties: {
          ...guard,
          planId: id,
          title: { type: 'string', minLength: 1, maxLength: 500 },
          question: { type: 'string', maxLength: 4000 },
          transition: { type: 'string', maxLength: 4000 }
        },
        required: ['expectedProjectId', 'expectedRevision', 'planId', 'title'],
        additionalProperties: false
      },
      outputSchema: { type: 'object', properties: { createdId: id, revision: { type: 'integer' } }, additionalProperties: true }
    },
    {
      name: 'create_node',
      description: '在假说图中创建生物学节点或论文卡；分支由节点间的多条联系表达。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'not idempotent',
      inputSchema: {
        type: 'object',
        properties: {
          ...guard,
          hypothesisId: id,
          label: { type: 'string', maxLength: 500 },
          kind: { enum: ['bio', 'paper'], default: 'bio' },
          point
        },
        required: ['expectedProjectId', 'expectedRevision', 'hypothesisId', 'label'],
        additionalProperties: false
      },
      outputSchema: { type: 'object', properties: { createdId: id, revision: { type: 'integer' } }, additionalProperties: true }
    },
    {
      name: 'create_edge',
      description: '连接两个假说节点。kind=main 为主线，branch 为条件分支，feedback 为由下游指回上游的反馈回路；支持连线本身挂素材。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'not idempotent',
      inputSchema: {
        type: 'object',
        properties: {
          ...guard,
          hypothesisId: id,
          source: id,
          target: id,
          claim: { type: 'string', maxLength: 4000 },
          condition: { type: ['string', 'null'], maxLength: 4000 },
          kind: { enum: ['main', 'branch', 'feedback'], default: 'main' }
        },
        required: ['expectedProjectId', 'expectedRevision', 'hypothesisId', 'source', 'target'],
        additionalProperties: false
      },
      outputSchema: { type: 'object', properties: { createdId: id, revision: { type: 'integer' } }, additionalProperties: true }
    },
    {
      name: 'create_panel',
      description: '在 Figure 中创建 Panel、文本、箭头或标注对象。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'not idempotent',
      inputSchema: {
        type: 'object',
        properties: {
          ...guard,
          planId: id,
          figureId: id,
          title: { type: 'string', maxLength: 500 },
          kind: { enum: ['panel', 'text', 'arrow', 'annotation'], default: 'panel' },
          point,
          w: { type: 'number', minimum: 40, maximum: 4000 },
          h: { type: 'number', minimum: 28, maximum: 4000 },
          purpose: { type: 'string', maxLength: 20000 },
          experiment: { type: 'string', maxLength: 20000 },
          readout: { type: 'string', maxLength: 20000 },
          expectedResult: { type: 'string', maxLength: 20000 },
          status: { enum: ['planned', 'running', 'complete', 'review'] }
        },
        required: ['expectedProjectId', 'expectedRevision', 'planId', 'figureId', 'title'],
        additionalProperties: false
      },
      outputSchema: { type: 'object', properties: { createdId: id, revision: { type: 'integer' } }, additionalProperties: true }
    },
    {
      name: 'layout',
      description: '自动整理当前 Figure 的 Panel 位置，不改变科学内容或证据绑定。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'same panel geometry returns current revision',
      inputSchema: {
        type: 'object',
        properties: { ...guard, planId: id, figureId: id },
        required: ['expectedProjectId', 'expectedRevision', 'planId', 'figureId'],
        additionalProperties: false
      },
      outputSchema: { type: 'object', properties: { revision: { type: 'integer' } }, additionalProperties: true }
    },
    {
      name: 'set_panel_status',
      description: '设置 Panel 的实验状态；已完成 Panel 才能由界面整理为证据块。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'same status returns current revision',
      inputSchema: {
        type: 'object',
        properties: {
          ...guard,
          planId: id,
          figureId: id,
          panelId: id,
          status: { enum: ['planned', 'running', 'complete', 'review'] }
        },
        required: ['expectedProjectId', 'expectedRevision', 'planId', 'figureId', 'panelId', 'status'],
        additionalProperties: false
      },
      outputSchema: { type: 'object', properties: { revision: { type: 'integer' } }, additionalProperties: true }
    },
    {
      name: 'attach_material',
      description: '把全局总库素材或组图自有证据附加到假说节点/联系，记录来源版本、支持/反对和备注。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'same target + sourceKind + resourceId returns existing link',
      inputSchema: {
        type: 'object',
        properties: {
          ...guard,
          hypothesisId: id,
          targetType: { enum: ['node', 'edge'] },
          targetId: id,
          materialType,
          sourceKind,
          resourceId: id,
          sourceSnapshot,
          stance,
          note
        },
        required: ['expectedProjectId', 'expectedRevision', 'hypothesisId', 'targetType', 'targetId', 'materialType', 'sourceKind', 'resourceId'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          linkId: id,
          revision: { type: 'integer' },
          changedPaths: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          idempotent: { type: 'boolean' }
        },
        additionalProperties: true
      }
    },
    {
      name: 'update_material_stance',
      description: '更新素材对节点/联系的支持、反对或待判断状态及备注。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'same values returns current revision',
      inputSchema: {
        type: 'object',
        properties: { ...guard, linkId: id, stance, note },
        required: ['expectedProjectId', 'expectedRevision', 'linkId', 'stance'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          linkId: id,
          revision: { type: 'integer' },
          changedPaths: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: true
      }
    },
    {
      name: 'create_evidence_block',
      description: '把一个 Figure 的已完成 Panel 组织成逻辑证据块；不改变 Panel 画板排布。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'same figure + title + panelIds returns existing block',
      inputSchema: {
        type: 'object',
        properties: {
          ...guard,
          planId: id,
          figureId: id,
          title: { type: 'string', minLength: 1, maxLength: 500 },
          panelIds: { type: 'array', minItems: 1, maxItems: 64, items: id, uniqueItems: true },
          summary: { type: 'string', maxLength: 4000 },
          status: { enum: ['draft', 'complete'], default: 'draft' }
        },
        required: ['expectedProjectId', 'expectedRevision', 'planId', 'figureId', 'title', 'panelIds'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          blockId: id,
          revision: { type: 'integer' },
          changedPaths: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: true
      }
    },
    {
      name: 'set_edge_relation',
      description: '设置假说联系的 main / branch / feedback 语义；不改变 source/target 实体身份。',
      access: 'write',
      approvalClass: 'routine_write',
      requiredScopes: ['workbench:write'],
      version: 1,
      idempotency: 'same kind/claim/condition returns current revision',
      inputSchema: {
        type: 'object',
        properties: {
          ...guard,
          hypothesisId: id,
          edgeId: id,
          kind: { enum: ['main', 'branch', 'feedback'] },
          claim: { type: 'string', maxLength: 4000 },
          condition: { type: 'string', maxLength: 4000 },
          status: { type: 'string', maxLength: 40 }
        },
        required: ['expectedProjectId', 'expectedRevision', 'hypothesisId', 'edgeId', 'kind'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          edgeId: id,
          revision: { type: 'integer' },
          changedPaths: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: true
      }
    }
  ];
  return {
    WORKBENCH_OPERATION_CONTRACT_VERSION,
    WORKBENCH_OPERATIONS: Object.freeze(operations.map(Object.freeze)),
    WORKBENCH_CAPABILITIES: Object.freeze({
      contractVersion: WORKBENCH_OPERATION_CONTRACT_VERSION,
      reads: Object.freeze(['query_global_library', 'open_local_pdf']),
      writes: Object.freeze([
        'create_project',
        'create_hypothesis',
        'create_plan',
        'create_figure',
        'create_node',
        'create_edge',
        'create_panel',
        'layout',
        'set_panel_status',
        'attach_material',
        'update_material_stance',
        'create_evidence_block',
        'set_edge_relation'
      ]),
      approvalClasses: Object.freeze(['none', 'routine_write', 'human_confirm', 'human_secret', 'human_os_picker'])
    })
  };
});
