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
  const schedule = {"type":"object","properties":{"start":{"type":"string","pattern":"^(?:|[0-9]{4}-[0-9]{2}-[0-9]{2})$"},"end":{"type":"string","pattern":"^(?:|[0-9]{4}-[0-9]{2}-[0-9]{2})$"},"owner":{"type":"string","maxLength":200},"progress":{"type":["number","null"],"minimum":0,"maximum":100}},"additionalProperties":false};
  const catalogId = prefix => ({ type: 'string', pattern: '^' + prefix + ':[A-Za-z0-9_-]{1,100}$', maxLength: 120 });
  const catalogFields = ['title', 'authors', 'journal', 'doi', 'pmid', 'publicationDate'];
  const catalogSort = { type: 'object', properties: { field: { enum: [...catalogFields, 'addedAt'] }, direction: { enum: ['asc', 'desc'] } }, required: ['field', 'direction'], additionalProperties: false };
  const catalogQueryFields = [...catalogFields, 'addedAt', 'legacyTags', 'tags', 'all', 'fulltext', 'notes', 'abstract', 'method', 'caption'];
  const catalogCondition = { oneOf: [
    { type: 'object', properties: { field: { enum: catalogQueryFields }, operator: { enum: ['exact', 'contains', 'before', 'after'] }, value: { type: 'string', maxLength: 4000 }, groupId: catalogId('group') }, required: ['field', 'operator', 'value'], additionalProperties: false },
    { type: 'object', properties: { field: { const: 'tagId' }, operator: { enum: ['has', 'notHas'] }, value: catalogId('tag') }, required: ['field', 'operator', 'value'], additionalProperties: false },
    { type: 'object', properties: { field: { const: 'groupId' }, operator: { enum: ['has', 'notHas'] }, value: catalogId('group') }, required: ['field', 'operator', 'value'], additionalProperties: false }
  ] };
  const catalogQuerySchema = { type: 'object', properties: {
    page: { type: 'integer', minimum: 1, default: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 40 },
    query: { type: 'string', maxLength: 4000 }, field: { enum: catalogQueryFields }, operator: { enum: ['exact', 'contains', 'before', 'after'] }, groupId: catalogId('group'),
    scope: { enum: ['all', 'local', 'radar', 'metadata-only', 'complete', 'partial', 'missing', 'unknown'] },
    tags: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 4096 } }, tagMode: { enum: ['any', 'all'] },
    includeRadarRead: { type: 'boolean', default: true }, includeRemoved: { type: 'boolean', default: false },
    conditions: { type: 'array', maxItems: 50, items: catalogCondition }, match: { enum: ['all', 'any'] }, sort: catalogSort
  }, additionalProperties: false };
  const catalogDate = { type: ['string', 'null'], maxLength: 24, pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' };
  const catalogFieldSchema = { type: 'object', properties: Object.fromEntries(catalogFields.map(field => [field, { type: ['string', 'null'], maxLength: ['title', 'authors'].includes(field) ? 20000 : 2000 }])), additionalProperties: false };
  const catalogAliases = { type: 'array', minItems: 1, maxItems: 256, uniqueItems: true, items: { type: 'string', maxLength: 800 } };
  const commandSchemas = [];
  const catalogCommand = (type, properties, required = []) => commandSchemas.push({ type: 'object', properties: { type: { const: type }, ...properties }, required: ['type', ...required], additionalProperties: false });
  catalogCommand('entry.create', { aliases: catalogAliases, fields: catalogFieldSchema, addedAt: catalogDate }, ['aliases']);
  catalogCommand('entry.update', { entryId: catalogId('entry'), fields: catalogFieldSchema, addedAt: catalogDate, clearOverrides: { type: 'array', maxItems: 6, uniqueItems: true, items: { enum: catalogFields } } }, ['entryId']);
  catalogCommand('entry.aliases.add', { entryId: catalogId('entry'), aliases: catalogAliases }, ['entryId', 'aliases']);
  for (const type of ['entry.remove', 'entry.restore']) catalogCommand(type, { entryId: catalogId('entry') }, ['entryId']);
  catalogCommand('group.create', { name: { type: 'string', minLength: 1, maxLength: 240 }, mode: { enum: ['single', 'multiple'] } }, ['name', 'mode']);
  catalogCommand('group.update', { groupId: catalogId('group'), name: { type: 'string', minLength: 1, maxLength: 240 }, mode: { enum: ['single', 'multiple'] } }, ['groupId']);
  for (const type of ['group.remove', 'group.restore']) catalogCommand(type, { groupId: catalogId('group') }, ['groupId']);
  catalogCommand('tag.create', { groupId: catalogId('group'), name: { type: 'string', minLength: 1, maxLength: 240 } }, ['groupId', 'name']);
  catalogCommand('tag.update', { groupId: catalogId('group'), tagId: catalogId('tag'), name: { type: 'string', minLength: 1, maxLength: 240 } }, ['groupId', 'tagId', 'name']);
  for (const type of ['tag.remove', 'tag.restore']) catalogCommand(type, { groupId: catalogId('group'), tagId: catalogId('tag') }, ['groupId', 'tagId']);
  catalogCommand('entry.tags.set', { entryId: catalogId('entry'), groupId: catalogId('group'), tagIds: { type: 'array', maxItems: 1000, uniqueItems: true, items: catalogId('tag') } }, ['entryId', 'groupId', 'tagIds']);
  catalogCommand('preferences.set', { preferences: { type: 'object', properties: {
    columns: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', maxLength: 120 } },
    groupOrder: { type: 'array', maxItems: 100, uniqueItems: true, items: catalogId('group') }, sort: catalogSort
  }, additionalProperties: false } }, ['preferences']);
  for (const type of ['attachment.remove', 'attachment.restore']) catalogCommand(type, { entryId: catalogId('entry'), attachmentId: catalogId('attachment') }, ['entryId', 'attachmentId']);
  const catalogCommandSchema = { type: 'object', properties: {
    expectedRevision: { type: 'integer', minimum: 0 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 160 }, command: { oneOf: commandSchemas }
  }, required: ['expectedRevision', 'idempotencyKey', 'command'], additionalProperties: false };
  const catalogReadSchema = { type: 'object', properties: {
    entryIds: { type: 'array', maxItems: 100, uniqueItems: true, items: catalogId('entry') },
    includeRemoved: { type: 'boolean', default: false }, page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 }
  }, additionalProperties: false };
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
      description: '读取文献总库：先按稳定来源/DOI/PMID归并，再字段精准或字面包含筛选、全局排序与分页；保留标签组、人工空值和全文命中，冲突不按标题强行合并。',
      access: 'read',
      approvalClass: 'none',
      requiredScopes: ['workbench:read'],
      version: 1,
      idempotency: 'read-only',
      inputSchema: catalogQuerySchema,
      outputSchema: {
        type: 'object',
        properties: {
          items: { type: 'array' },
          page: { type: 'integer' },
          pageCount: { type: 'integer' },
          matchedCount: { type: 'integer' },
          sources: { type: 'object' },
          warnings: { type: 'array' }, catalogRevision: { type: 'integer' }, groups: { type: 'array' }, preferences: { type: 'object' }
        },
        additionalProperties: true
      }
    },
    {
      name: 'read_library_catalog', description: '读取当前可选目录revision、稳定entry/group/tag ID与当前字段；不返回幂等回执或历史命令。无需当前课题。',
      access: 'read', approvalClass: 'none', requiredScopes: ['workbench:read'], global: true, version: 1, idempotency: 'read-only',
      inputSchema: catalogReadSchema, outputSchema: { type: 'object', additionalProperties: true }
    },
    {
      name: 'command_library_catalog', description: '对全局目录执行一条CAS/幂等命令。每次实际写入必须由原生UI确认具体前后值；不能用课题scope绕过。移除为可恢复关联，不删除原件；禁止上传bytes或伪造附件可用性。',
      access: 'write', approvalClass: 'human_confirm', requiredScopes: [], global: true, version: 1, idempotency: 'catalog CAS and exact command receipt',
      inputSchema: catalogCommandSchema, outputSchema: { type: 'object', additionalProperties: true }
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
          schedule,
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
    {"name":"set_panel_schedule","description":"更新 Panel 排期，按字段合并；空日期/空负责人/null进度用于清除，保留0。","access":"write","approvalClass":"routine_write","requiredScopes":["workbench:write"],"version":1,"idempotency":"CAS guarded","inputSchema":{"type":"object","properties":{"expectedProjectId":{"type":"string"},"expectedRevision":{"type":"integer","minimum":0},"planId":{"type":"string"},"figureId":{"type":"string"},"panelId":{"type":"string"},"schedule":{"type":"object","properties":{"start":{"type":"string","pattern":"^(?:|[0-9]{4}-[0-9]{2}-[0-9]{2})$"},"end":{"type":"string","pattern":"^(?:|[0-9]{4}-[0-9]{2}-[0-9]{2})$"},"owner":{"type":"string","maxLength":200},"progress":{"type":["number","null"],"minimum":0,"maximum":100}},"additionalProperties":false}},"required":["expectedProjectId","expectedRevision","planId","figureId","panelId","schedule"],"additionalProperties":false},"outputSchema":{"type":"object","additionalProperties":true}},
    {
      name: 'set_panel_status',
      description: '设置 Panel 的实验状态；未完成 Panel 的证据块保留为草稿。',
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
      description: '把一个 Figure 的 Panel 组织成逻辑证据块；含未完成 Panel 时保存为草稿；不改变 Panel 画板排布。',
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
          method: note, observation: note, conclusion: note,
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
      reads: Object.freeze(['query_global_library', 'read_library_catalog', 'open_local_pdf']),
      writes: Object.freeze([
        'command_library_catalog',
        'create_project',
        'create_hypothesis',
        'create_plan',
        'create_figure',
        'create_node',
        'create_edge',
        'create_panel',
        'layout',
        'set_panel_status',
        'set_panel_schedule',
        'attach_material',
        'update_material_stance',
        'create_evidence_block',
        'set_edge_relation'
      ]),
      approvalClasses: Object.freeze(['none', 'routine_write', 'human_confirm', 'human_secret', 'human_os_picker'])
    })
  };
});
