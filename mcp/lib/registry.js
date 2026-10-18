'use strict';

const { createAgentTools } = require('../../workbench/agent-tools.js');
const { createRadarAgentTools } = require('../../core/literature-radar-agent-tools.js');
const { BrevessMcpError, asError } = require('./errors.js');
const { WriteScopeManager } = require('./scopes.js');

const READ_CONTEXT = 'workbench.read_context';
const SERVER_NAME = 'brevess-mcp';
const SERVER_VERSION = '0.1.0';
const WORKBENCH_OPERATION_CONTRACT_VERSION = '1';
const MCP_TOOL_CONTRACT_VERSION = '1';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stripSecretFields(value, depth = 0) {
  if (depth > 40 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => stripSecretFields(item, depth + 1));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (['scopeToken', 'bridgeToken', 'mcpToken'].includes(key)) continue;
    output[key] = stripSecretFields(child, depth + 1);
  }
  return output;
}

function fakeAgentTools() {
  const session = {
    state: {
      row: null,
      selection: { selection: {} },
      view: { revision: 0, view: {} },
      scopes: new Map(),
      undo: [],
      redo: [],
      proposal: null
    },
    edit() {
      throw new Error('definitions only');
    }
  };
  return createAgentTools({ session, adapter: {} }).definitions;
}

function radarDefinitions() {
  return createRadarAgentTools({ store: {}, service: {} }).definitions;
}

function addDescription(schema, text) {
  return { ...schema, description: text };
}

function withIdempotency(schema) {
  const next = clone(schema);
  next.type ||= 'object';
  next.properties ||= {};
  next.properties.idempotencyKey = {
    type: 'string',
    minLength: 8,
    maxLength: 160,
    description: 'Stable key for this logical write. Repeating the same key returns the original receipt.'
  };
  return next;
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

function highLevelTools() {
  const point = objectSchema({
    x: { type: 'number' },
    y: { type: 'number' }
  });
  const node = objectSchema({
    key: { type: 'string', minLength: 1, maxLength: 80 },
    label: { type: 'string', minLength: 1, maxLength: 20_000 },
    kind: { enum: ['bio', 'paper'], default: 'bio' },
    point,
    resourceId: { type: 'string', description: 'An already captured project resource ID.' }
  }, ['label']);
  const edge = objectSchema({
    from: { type: 'string', description: 'Node key or node ID.' },
    to: { type: 'string', description: 'Node key or node ID.' },
    claim: { type: 'string', maxLength: 20_000 },
    condition: { type: ['string', 'null'], maxLength: 20_000 }
  }, ['from', 'to']);
  const panel = objectSchema({
    key: { type: 'string', minLength: 1, maxLength: 80 },
    title: { type: 'string', minLength: 1, maxLength: 20_000 },
    kind: { enum: ['panel', 'text', 'arrow', 'annotation'], default: 'panel' },
    point,
    w: { type: 'number', minimum: 40 },
    h: { type: 'number', minimum: 28 },
    purpose: { type: 'string' },
    experiment: { type: 'string' },
    readout: { type: 'string' },
    expectedResult: { type: 'string' },
    status: { enum: ['planned', 'running', 'complete', 'review'] }
  }, ['title']);
  const figure = objectSchema({
    key: { type: 'string', minLength: 1, maxLength: 80 },
    title: { type: 'string', minLength: 1, maxLength: 20_000 },
    question: { type: 'string' },
    transition: { type: 'string' },
    panels: { type: 'array', maxItems: 200, items: panel }
  }, ['title']);
  return [
    {
      name: 'workbench.plan_hypotheses',
      title: 'Plan hypotheses and a causal graph',
      description: 'Create a hypothesis (or extend an existing one) with nodes and edges in one CAS-protected Workbench edit. The returned IDs can be bound to literature evidence with literature.import_and_bind.',
      inputSchema: withIdempotency(objectSchema({
        expectedProjectId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
        hypothesisId: { type: 'string', description: 'Extend this existing hypothesis instead of creating one.' },
        name: { type: 'string', maxLength: 20_000 },
        nodes: { type: 'array', minItems: 1, maxItems: 200, items: node },
        edges: { type: 'array', maxItems: 500, items: edge }
      }, ['expectedProjectId', 'expectedRevision', 'nodes'])),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: 'workbench.plan_figures',
      title: 'Plan figures and panels',
      description: 'Create a figure plan (or extend an existing plan) with Figures and Panels in one CAS-protected edit. Layout, references, grouping and later design steps remain available through workbench.model_operation.',
      inputSchema: withIdempotency(objectSchema({
        expectedProjectId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
        planId: { type: 'string', description: 'Add figures to this existing plan.' },
        planName: { type: 'string', maxLength: 20_000 },
        figures: { type: 'array', minItems: 1, maxItems: 50, items: figure }
      }, ['expectedProjectId', 'expectedRevision', 'figures'])),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: 'library.import_and_bind',
      title: 'Read saved literature and bind evidence',
      description: 'Read one exact saved workspace version, select a paper/figure/panel/evidence resource, and bind it to a hypothesis edge, a Figure Panel, or a new hypothesis node. Source identity and revision are preserved.',
      inputSchema: withIdempotency(objectSchema({
        expectedProjectId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
        source: objectSchema({
          workspaceId: { type: 'string' },
          workspaceGeneration: { type: 'integer', minimum: 1 }
        }, ['workspaceId', 'workspaceGeneration']),
        title: { type: 'string' },
        resourceId: { type: 'string', description: 'Optional ID from a previous library.read_workspace result.' },
        resourceType: { enum: ['paper', 'figure', 'panel', 'block', 'fragment'] },
        target: {
          oneOf: [
            objectSchema({
              kind: { const: 'panel' },
              planId: { type: 'string' },
              figureId: { type: 'string' },
              panelId: { type: 'string' }
            }, ['kind', 'planId', 'figureId', 'panelId']),
            objectSchema({
              kind: { const: 'edge' },
              hypothesisId: { type: 'string' },
              edgeId: { type: 'string' }
            }, ['kind', 'hypothesisId', 'edgeId']),
            objectSchema({
              kind: { const: 'node' },
              hypothesisId: { type: 'string' },
              point
            }, ['kind', 'hypothesisId'])
          ]
        },
        note: { type: 'string' },
        borrow: { type: 'string' }
      }, ['expectedProjectId', 'expectedRevision', 'source', 'target'])),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: 'workbench.project_summary',
      title: 'Summarize the current project',
      description: 'Return revision, entity counts, selected context, pending-review counts and the next useful tool calls without returning the whole project body.',
      inputSchema: objectSchema({
        expectedProjectId: { type: ['string', 'null'] },
        expectedRevision: { type: 'integer', minimum: 0 }
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: 'workbench.read_more',
      title: 'Read a large result chunk',
      description: 'Read a byte range from a result that exceeded the inline MCP response limit.',
      inputSchema: objectSchema({
        cursor: { type: 'string', minLength: 8, maxLength: 200 },
        offsetBytes: { type: 'integer', minimum: 0 },
        maxBytes: { type: 'integer', minimum: 1, maximum: 262144 }
      }, ['cursor']),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: 'library.query_global_library',
      bridgeName: 'query_global_library',
      title: 'Query the global literature library',
      description: 'Read the merged local library plus read:true radar metadata. Radar-only records are metadata-only and never impersonate a saved workspace.',
      inputSchema: objectSchema({
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        query: { type: 'string' },
        scope: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        tagMode: { enum: ['any', 'all'] },
        includeRadarRead: { type: 'boolean', default: true }
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'none', operationContract: WORKBENCH_OPERATION_CONTRACT_VERSION }
    },
    {
      name: 'pdf.open_local',
      bridgeName: 'open_local_pdf',
      title: 'Open a local PDF through the Workbench',
      description: 'Open an explicitly supplied local file URL through the existing PDF reader, returning the real page count, outline, title, DOI and reference count only after parsing. The tool does not modify or upload the PDF.',
      inputSchema: objectSchema({
        fileUrl: { type: 'string', pattern: '^file:///', maxLength: 4096 },
        title: { type: 'string', maxLength: 2000 },
        expectedProjectId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 0 }
      }, ['fileUrl']),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'human_confirm', operationContract: 'PDF-READER-v1' }
    },
    {
      name: 'library.export_transfer',
      bridgeName: 'export_library_transfer',
      title: 'Export portable library metadata',
      description: 'Export radar tasks and/or the merged global-library directory as brevess-library-transfer-v1. Only metadata, tags, sourceDocuments inventory and availability/status are included; no PDF bytes, credentials or full-text storage are exported.',
      inputSchema: objectSchema({
        scope: { enum: ['radar', 'global-library', 'combined'], default: 'combined' },
        radarIds: { type: 'array', maxItems: 50, items: { type: 'string' } },
        includeRevisions: { type: 'boolean', default: true }
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'none', operationContract: 'library-transfer-v1' }
    },
    {
      name: 'library.import_transfer',
      bridgeName: 'import_library_transfer',
      title: 'Import portable library metadata',
      description: 'Validate and atomically merge a brevess-library-transfer-v1 bundle. Deduplicates by PMID, then DOI, then normalized title. Radar query conflicts preserve the existing task; global metadata conflicts preserve existing metadata and return warnings. The host must show a human confirmation before committing.',
      inputSchema: withIdempotency(objectSchema({
        bundle: { type: 'object' },
        expectedTransferRevision: { type: 'integer', minimum: 0 }
      }, ['bundle'])),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'human_confirm', operationContract: 'library-transfer-v1' }
    },
    {
      name: 'workbench.attach_material',
      bridgeName: 'attach_material',
      title: 'Attach a material to a hypothesis node or edge',
      description: 'Attach a library or plan material with support/oppose/neutral stance. Duplicate target + source returns the existing link.',
      inputSchema: withIdempotency(objectSchema({
        expectedProjectId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
        hypothesisId: { type: 'string' },
        targetType: { enum: ['node', 'edge'] },
        targetId: { type: 'string' },
        materialType: { enum: ['paper', 'figure', 'panel', 'evidence-block'] },
        sourceKind: { enum: ['library', 'plan'] },
        resourceId: { type: 'string' },
        stance: { enum: ['support', 'oppose', 'neutral'] },
        note: { type: 'string', maxLength: 4000 },
        sourceSnapshot: { type: 'object' }
      }, ['expectedProjectId', 'expectedRevision', 'hypothesisId', 'targetType', 'targetId',
        'materialType', 'sourceKind', 'resourceId', 'stance'])),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'task_scope', operationContract: WORKBENCH_OPERATION_CONTRACT_VERSION }
    },
    {
      name: 'workbench.update_material_stance',
      bridgeName: 'update_material_stance',
      title: 'Update a material stance or note',
      description: 'Change only stance/note/updatedAt for an existing material link. Resource identity and source snapshot cannot change.',
      inputSchema: withIdempotency(objectSchema({
        expectedProjectId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
        linkId: { type: 'string' },
        stance: { enum: ['support', 'oppose', 'neutral'] },
        note: { type: 'string', maxLength: 4000 }
      }, ['expectedProjectId', 'expectedRevision', 'linkId', 'stance'])),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'task_scope', operationContract: WORKBENCH_OPERATION_CONTRACT_VERSION }
    },
    {
      name: 'workbench.create_evidence_block',
      bridgeName: 'create_evidence_block',
      title: 'Create an evidence block',
      description: 'Create a logical evidence block for a Figure without moving Panel coordinates. Repeating the same Figure/title/panelIds returns the existing block.',
      inputSchema: withIdempotency(objectSchema({
        expectedProjectId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
        planId: { type: 'string' },
        figureId: { type: 'string' },
        title: { type: 'string', minLength: 1, maxLength: 4000 },
        panelIds: { type: 'array', minItems: 1, maxItems: 200, uniqueItems: true, items: { type: 'string' } },
        summary: { type: 'string', maxLength: 20000 },
        status: { enum: ['draft', 'complete'] }
      }, ['expectedProjectId', 'expectedRevision', 'planId', 'figureId', 'title', 'panelIds'])),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'task_scope', operationContract: WORKBENCH_OPERATION_CONTRACT_VERSION }
    },
    {
      name: 'workbench.set_edge_relation',
      bridgeName: 'set_edge_relation',
      title: 'Set an edge relation kind',
      description: 'Set main/branch/feedback while preserving source and target identity. Old edges without kind read as main and are not migrated.',
      inputSchema: withIdempotency(objectSchema({
        expectedProjectId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
        hypothesisId: { type: 'string' },
        edgeId: { type: 'string' },
        kind: { enum: ['main', 'branch', 'feedback'] },
        claim: { type: 'string' },
        condition: { type: 'string' },
        status: { type: 'string' }
      }, ['expectedProjectId', 'expectedRevision', 'hypothesisId', 'edgeId', 'kind'])),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'task_scope', operationContract: WORKBENCH_OPERATION_CONTRACT_VERSION }
    },
    {
      name: 'brevess.request_write_scope',
      title: 'Request a task-level write scope',
      description: 'Ask the human to approve a short-lived scope for routine writes. Empty Workbench: use projectId:null, bootstrap:true and operations:["workbench.create_project"]; never invent a projectId. The tool returns PENDING_HUMAN_ACTION until the Workbench UI approves; scope tokens never leave the MCP server.',
      inputSchema: objectSchema({
        projectId: { type: ['string', 'null'] },
        operations: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'string' } },
        reason: { type: 'string', maxLength: 4000 },
        ttlMs: { type: 'integer', minimum: 60000, maximum: 3600000 },
        ttlSeconds: { type: 'integer', minimum: 60, maximum: 3600 },
        bootstrap: { type: 'boolean', description: 'Only for an empty Workbench and create_project.' },
        taskId: { type: 'string', maxLength: 160 },
        approvalId: { type: 'string' }
      }, ['operations']),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'human_confirm', operationContract: MCP_TOOL_CONTRACT_VERSION }
    },
    {
      name: 'brevess.revoke_write_scope',
      title: 'Revoke the task-level write scope',
      description: 'Revoke the current MCP write scope immediately. Reversible; a new scope requires another human approval.',
      inputSchema: objectSchema({ scopeId: { type: 'string' } }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'human_confirm', operationContract: MCP_TOOL_CONTRACT_VERSION }
    },
    {
      name: 'brevess.status',
      title: 'Read MCP and Workbench status',
      description: 'Read server scope, bridge health and the Workbench host write-scope state. Never returns a scope or bridge token.',
      inputSchema: objectSchema({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'none', operationContract: MCP_TOOL_CONTRACT_VERSION }
    },
    {
      name: 'brevess.capabilities',
      title: 'Merge static and Workbench capabilities',
      description: 'Return MCP tools plus the Workbench listCapabilities result, including operation contract versions and approval classes.',
      inputSchema: objectSchema({ includeSchemas: { type: 'boolean', default: false } }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { approvalClass: 'none', operationContract: MCP_TOOL_CONTRACT_VERSION }
    }
  ];
}

function directToolName(bridgeName) {
  if (bridgeName === 'query_library') return 'library.query_library';
  if (bridgeName === 'read_literature') return 'library.read_workspace';
  if (bridgeName === 'local_data') return 'library.local_data';
  if (bridgeName.startsWith('radar_')) return `radar.${bridgeName.slice('radar_'.length)}`;
  return `workbench.${bridgeName}`;
}

const LOCAL_DATA_MUTATIONS = new Set(['patch_asset', 'set_tags', 'delete_workspace']);
const DIRECT_READ_ONLY = new Set([
  'read_context',
  'list_projects',
  'get_project',
  'query_library',
  'read_literature',
  'list_recycle',
  'export_project',
  'read_asset',
  'radar_list',
  'radar_get'
]);
const DESTRUCTIVE = new Set(['remove_entity', 'delete_workspace']);
const CONTRACT_READ_ONLY = new Set([
  'library.query_global_library',
  'library.export_transfer',
  'pdf.open_local'
]);
const HUMAN_CONFIRM_TOOLS = new Set([
  'workbench.remove_entity',
  'workbench.restore',
  'workbench.import_project',
  'workbench.data_directory',
  'library.local_data'
]);

function directMutating(bridgeName, args) {
  if (DIRECT_READ_ONLY.has(bridgeName)) return false;
  if (bridgeName === 'local_data') return LOCAL_DATA_MUTATIONS.has(args?.operation);
  return true;
}

function directAnnotations(bridgeName) {
  const readOnly = DIRECT_READ_ONLY.has(bridgeName);
  return {
    readOnlyHint: readOnly,
    destructiveHint: DESTRUCTIVE.has(bridgeName) ||
      (bridgeName === 'local_data' && false),
    idempotentHint: true,
    openWorldHint: bridgeName === 'radar_check' || bridgeName === 'radar_backfill_abstracts'
  };
}

function createRegistry({
  hub,
  allowWrite = false,
  scopeManager = new WriteScopeManager()
} = {}) {
  if (!hub || typeof hub.call !== 'function') {
    throw new BrevessMcpError('BRIDGE_HUB_REQUIRED', 'A bridge hub is required.');
  }
  const tools = new Map();

  for (const definition of fakeAgentTools()) {
    const name = directToolName(definition.name);
    tools.set(name, {
      name,
      title: definition.name.replaceAll('_', ' '),
      description: definition.name === 'create_project'
        ? '空工作区先调用 brevess.request_write_scope，参数 {projectId:null,bootstrap:true,operations:["workbench.create_project"]}；用户确认后调用 create_project(expectedProjectId:null,expectedRevision:0)；成功后 read_context 取真实 projectId/revision，再申请普通项目 scope。不要编造 projectId。'
        : definition.description,
      inputSchema: withIdempotency(definition.inputSchema),
      annotations: directAnnotations(definition.name),
      bridgeName: definition.name,
      kind: 'direct'
    });
  }
  for (const definition of radarDefinitions()) {
    const name = directToolName(definition.name);
    tools.set(name, {
      name,
      title: definition.name.replaceAll('_', ' '),
      description: definition.description,
      inputSchema: withIdempotency(definition.inputSchema),
      annotations: directAnnotations(definition.name),
      bridgeName: definition.name,
      kind: 'direct'
    });
  }
  for (const definition of highLevelTools()) {
    const kind = definition.name.startsWith('brevess.') ? 'control'
      : definition.bridgeName ? 'contract'
        : 'high-level';
    tools.set(definition.name, {
      ...definition,
      kind
    });
  }

  function list() {
    return [...tools.values()].map(tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      ...(tool._meta ? { _meta: tool._meta } : {})
    }));
  }

  function writeRequired(tool, args) {
    if (tool.kind === 'control') {
      return !new Set(['brevess.status', 'brevess.capabilities']).has(tool.name);
    }
    if (tool.kind === 'contract') {
      return !CONTRACT_READ_ONLY.has(tool.name);
    }
    if (tool.kind === 'high-level') {
      return !new Set(['workbench.project_summary', 'workbench.read_more']).has(tool.name);
    }
    return directMutating(tool.bridgeName, args);
  }

  function validateIdempotency(tool, args) {
    if (tool.kind === 'control') return;
    if (!writeRequired(tool, args)) return;
    const key = args?.idempotencyKey;
    if (typeof key !== 'string' || key.length < 8 || key.length > 160) {
      throw new BrevessMcpError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Mutating calls require an idempotencyKey between 8 and 160 characters.',
        {
          field: 'idempotencyKey',
          tool: tool.name,
          correction: 'Generate a stable UUID for this logical operation and reuse it only for retries.'
        }
      );
    }
  }

  function projectGuard(args) {
    if (typeof args?.expectedProjectId !== 'string' || args.expectedProjectId.length < 1 ||
        !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
      throw new BrevessMcpError(
        'PROJECT_GUARD_REQUIRED',
        'This high-level write requires expectedProjectId and expectedRevision.',
        {
          field: 'expectedRevision',
          correction: 'Call workbench.read_context first and pass its projectId and revision.'
        }
      );
    }
  }

  async function bridgeCall(tool, args, context) {
    return hub.call(tool.bridgeName || tool.name, args, {
      mcpRequestId: context?.requestId,
      hostOptions: context?.scopeToken ? { scopeToken: context.scopeToken } : undefined,
      timeoutMs: tool.bridgeName === 'radar_check'
        ? Math.max(context?.timeoutMs || 0, 150000)
        : tool.bridgeName === 'local_data'
          ? Math.max(context?.timeoutMs || 0, 160000)
          : context?.timeoutMs
    });
  }

  function hostOperationNames(name) {
    if (name === 'workbench.plan_hypotheses') {
      return ['create_hypothesis', 'create_node', 'create_edge'];
    }
    if (name === 'workbench.plan_figures') {
      return ['create_plan', 'create_figure', 'create_panel'];
    }
    const bridgeName = tools.get(name)?.bridgeName;
    return [bridgeName || String(name).replace(/^[^.]+\./u, '')];
  }

  async function requestWriteScope(args, context) {
    if (!allowWrite) {
      throw new BrevessMcpError(
        'MCP_WRITE_DISABLED',
        'This MCP server was started with write transport disabled.',
        {
          correction: 'Restart the server with --allow-write before requesting a human-approved write scope.'
        }
      );
    }
    const request = scopeManager.request(args);
    if (request.status === 'PENDING_HUMAN_ACTION') return request;
    for (const operation of request.operations) {
      const scoped = tools.get(operation);
      if (!scoped) {
        throw new BrevessMcpError('MCP_WRITE_SCOPE_INVALID', `Unknown scoped operation: ${operation}`, {
          field: 'operations',
          allowedValues: [...tools.values()].filter(tool => writeRequired(tool, {})).map(tool => tool.name)
        });
      }
      if (HUMAN_CONFIRM_TOOLS.has(operation) ||
          operation === 'library.local_data' && LOCAL_DATA_MUTATIONS.has(args?.operation)) {
        throw new BrevessMcpError(
          'HUMAN_CONFIRMATION_REQUIRED',
          `${operation} requires a per-operation human confirmation, not a task-wide scope.`,
          {
            field: 'operations',
            operation,
            correction: 'Open the specific Workbench preview and approve that operation in the UI.'
          }
        );
      }
    }
    const hostOperations = request.operations.flatMap(hostOperationNames);
    const hostArgs = {
      ...args,
      projectId: request.projectId || args?.projectId,
      operations: hostOperations,
      hostOperations,
      mcpOperations: request.operations,
      reason: request.reason,
      ttlMs: request.ttlMs,
      taskId: request.taskId
    };
    const response = await hub.call('brevess.request_write_scope', hostArgs, {
      mcpRequestId: context?.requestId,
      timeoutMs: Math.max(context?.timeoutMs || 0, 180000)
    });
    if (response?.success === false) {
      throw new BrevessMcpError(
        response.error?.code || 'WORKBENCH_WRITE_SCOPE_DENIED',
        response.error?.message || 'The user did not grant a write scope.',
        response.error?.details,
        { retryable: false }
      );
    }
    const applied = scopeManager.applyHostResult(response, {
      ...request,
      hostOperations
    });
    return {
      ...applied,
      ...(scopeManager.status().pending ? { pending: scopeManager.status().pending } : {}),
      ...(scopeManager.status().granted ? { scope: scopeManager.status().scope } : {})
    };
  }

  async function hostStatus(context) {
    let host = null;
    let hostError = null;
    try {
      host = await hub.call('brevess.status', {}, {
        mcpRequestId: context?.requestId,
        timeoutMs: Math.min(context?.timeoutMs || 30000, 30000)
      });
      host = scopeManager.mergeHostStatus(host);
    } catch (error) {
      hostError = { code: error.code || 'MCP_WORKBENCH_HOST_UNAVAILABLE', message: error.message };
    }
    return {
      server: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        toolContractVersion: MCP_TOOL_CONTRACT_VERSION,
        operationContractVersion: WORKBENCH_OPERATION_CONTRACT_VERSION,
        writeTransport: allowWrite
      },
      bridge: hub.status(),
      writeScope: scopeManager.status(),
      host,
      ...(hostError ? { hostError } : {})
    };
  }

  async function hostCapabilities(args, context) {
    let host = null;
    let hostError = null;
    try {
      host = await hub.call('brevess.capabilities', {
        includeSchemas: args.includeSchemas === true
      }, {
        mcpRequestId: context?.requestId,
        timeoutMs: Math.min(context?.timeoutMs || 30000, 30000)
      });
    } catch (error) {
      hostError = { code: error.code || 'MCP_WORKBENCH_HOST_UNAVAILABLE', message: error.message };
    }
    return {
      server: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        toolContractVersion: MCP_TOOL_CONTRACT_VERSION,
        operationContractVersion: WORKBENCH_OPERATION_CONTRACT_VERSION
      },
      scopes: allowWrite ? ['read', 'write'] : ['read'],
      tools: list(),
      workbench: host,
      ...(hostError ? { hostError } : {})
    };
  }

  async function revokeWriteScope(args, context) {
    const current = scopeManager.current();
    const hostToken = current?.hostToken;
    let hostResult = null;
    let hostError = null;
    try {
      hostResult = await hub.call('brevess.revoke_write_scope', {
        scopeId: args.scopeId || current?.scopeId,
        ...(hostToken ? { scopeToken: hostToken } : {})
      }, {
        mcpRequestId: context?.requestId,
        timeoutMs: Math.min(context?.timeoutMs || 30000, 30000)
      });
    } catch (error) {
      hostError = { code: error.code || 'MCP_WORKBENCH_HOST_UNAVAILABLE', message: error.message };
    }
    const local = scopeManager.revoke(args.scopeId || current?.scopeId);
    return {
      ...local,
      host: hostResult,
      ...(hostError ? { hostError, warning: 'Local MCP scope was revoked even though the host did not confirm.' } : {})
    };
  }

  async function planHypotheses(args, context) {
    projectGuard(args);
    const created = { hypothesisId: null, nodes: [], edges: [] };
    const receipts = [];
    const warnings = [];
    let revision = args.expectedRevision;
    let hypothesisId = args.hypothesisId || null;
    const run = async (operation, extra) => {
      const result = await bridgeCall({
        name: `workbench.${operation}`,
        bridgeName: operation
      }, {
        expectedProjectId: args.expectedProjectId,
        expectedRevision: revision,
        operation,
        ...extra
      }, context);
      const nextRevision = Number.isSafeInteger(result?.revision) ? result.revision : revision + 1;
      revision = nextRevision;
      receipts.push({
        operation,
        createdId: result?.createdId || null,
        revision: nextRevision
      });
      return result;
    };
    if (!hypothesisId) {
      if (typeof args.name !== 'string' || !args.name.trim()) {
        throw new BrevessMcpError('WORKBENCH_AGENT_INVALID_ARGUMENT', 'A hypothesis name is required.', {
          field: 'name',
          correction: 'Provide name when hypothesisId is absent.'
        });
      }
      const hypothesis = await run('create_hypothesis', { name: args.name.trim() });
      hypothesisId = hypothesis?.createdId;
      if (!hypothesisId) {
        throw new BrevessMcpError('WORKBENCH_HYPOTHESIS_RECEIPT_INVALID', 'create_hypothesis returned no createdId.', {
          operation: 'create_hypothesis'
        });
      }
      created.hypothesisId = hypothesisId;
    } else {
      created.hypothesisId = hypothesisId;
    }
    const nodeIds = new Map();
    let fallback = 0;
    for (const [index, input] of args.nodes.entries()) {
      const key = input.key || `node-${index + 1}`;
      if (nodeIds.has(key)) {
        throw new BrevessMcpError('WORKBENCH_AGENT_INVALID_ARGUMENT', `Duplicate node key: ${key}`, {
          field: `nodes.${index}.key`,
          correction: 'Use a unique key for each node.'
        });
      }
      const point = input.point || {
        x: (fallback % 4) * 260,
        y: Math.floor(fallback / 4) * 150
      };
      fallback += 1;
      const result = await run('create_node', {
        hypothesisId,
        label: input.label,
        kind: input.kind || 'bio',
        point
      });
      if (!result?.createdId) {
        throw new BrevessMcpError('WORKBENCH_NODE_RECEIPT_INVALID', 'create_node returned no createdId.');
      }
      nodeIds.set(key, result.createdId);
      nodeIds.set(result.createdId, result.createdId);
      created.nodes.push(result.createdId);
      if (input.resourceId) warnings.push(`Node ${key} resourceId was not attached by create_node; use bookbinder attach/bind after creation.`);
    }
    for (const [index, input] of (args.edges || []).entries()) {
      const source = nodeIds.get(input.from);
      const target = nodeIds.get(input.to);
      if (!source || !target) {
        throw new BrevessMcpError(
          'WORKBENCH_DANGLING_EDGE',
          `Edge ${index} refers to a node that is not in this request or project.`,
          {
            field: `edges.${index}`,
            correction: 'Use a node key from nodes, or create the node first and then use workbench.model_operation.'
          }
        );
      }
      const result = await run('create_edge', {
        hypothesisId,
        source,
        target,
        claim: input.claim || '',
        condition: input.condition === undefined ? '' : input.condition
      });
      if (!result?.createdId) {
        throw new BrevessMcpError('WORKBENCH_EDGE_RECEIPT_INVALID', 'create_edge returned no createdId.');
      }
      created.edges.push(result.createdId);
    }
    return {
      projectId: args.expectedProjectId,
      revision,
      createdIds: created,
      receipts,
      warnings
    };
  }

  async function planFigures(args, context) {
    projectGuard(args);
    const created = { planId: null, figures: [], panels: [] };
    const receipts = [];
    const warnings = [];
    let revision = args.expectedRevision;
    const run = async (operation, extra) => {
      const result = await bridgeCall({
        name: `workbench.${operation}`,
        bridgeName: operation
      }, {
        expectedProjectId: args.expectedProjectId,
        expectedRevision: revision,
        operation,
        ...extra
      }, context);
      revision = Number.isSafeInteger(result?.revision) ? result.revision : revision + 1;
      receipts.push({
        operation,
        createdId: result?.createdId || null,
        revision
      });
      return result;
    };
    let planId = args.planId || null;
    if (!planId) {
      const result = await run('create_plan', { name: args.planName || '组图规划' });
      planId = result?.createdId;
      if (!planId) {
        throw new BrevessMcpError('WORKBENCH_PLAN_RECEIPT_INVALID', 'create_plan returned no createdId.');
      }
      created.planId = planId;
    } else {
      created.planId = planId;
    }
    for (const [figureIndex, input] of args.figures.entries()) {
      const figure = await run('create_figure', {
        planId,
        title: input.title,
        ...(input.question !== undefined ? { question: input.question } : {}),
        ...(input.transition !== undefined ? { transition: input.transition } : {})
      });
      const figureId = figure?.createdId;
      if (!figureId) {
        throw new BrevessMcpError('WORKBENCH_FIGURE_RECEIPT_INVALID', 'create_figure returned no createdId.');
      }
      created.figures.push(figureId);
      for (const [panelIndex, inputPanel] of (input.panels || []).entries()) {
        const point = inputPanel.point || {
          x: (panelIndex % 3) * 290,
          y: Math.floor(panelIndex / 3) * 230
        };
        const panel = await run('create_panel', {
          planId,
          figureId,
          title: inputPanel.title,
          kind: inputPanel.kind || 'panel',
          point,
          ...(inputPanel.w !== undefined ? { w: inputPanel.w } : {}),
          ...(inputPanel.h !== undefined ? { h: inputPanel.h } : {}),
          ...(inputPanel.purpose !== undefined ? { purpose: inputPanel.purpose } : {}),
          ...(inputPanel.experiment !== undefined ? { experiment: inputPanel.experiment } : {}),
          ...(inputPanel.readout !== undefined ? { readout: inputPanel.readout } : {}),
          ...(inputPanel.expectedResult !== undefined ? { expectedResult: inputPanel.expectedResult } : {}),
          ...(inputPanel.status !== undefined ? { status: inputPanel.status } : {})
        });
        if (!panel?.createdId) {
          throw new BrevessMcpError('WORKBENCH_PANEL_RECEIPT_INVALID', 'create_panel returned no createdId.');
        }
        created.panels.push(panel.createdId);
      }
    }
    return {
      projectId: args.expectedProjectId,
      revision,
      createdIds: created,
      receipts,
      warnings
    };
  }

  async function importAndBind(args, context) {
    projectGuard(args);
    const literature = await bridgeCall({
      name: 'library.read_workspace',
      bridgeName: 'read_literature'
    }, {
      source: args.source,
      title: args.title || ''
    }, context);
    const rows = [
      ...(literature.resources || []),
      ...(literature.historicalResources || [])
    ];
    let resource = args.resourceId ? rows.find(row => row.id === args.resourceId) : null;
    if (!resource && args.resourceType) {
      resource = rows.find(row => row.type === args.resourceType);
    }
    if (!resource) resource = rows.find(row => row.type === 'paper') || rows[0];
    if (!resource) {
      throw new BrevessMcpError(
        'LITERATURE_RESOURCE_NOT_FOUND',
        'The saved workspace did not project a bindable resource.',
        {
          source: args.source,
          allowedTypes: [...new Set(rows.map(row => row.type))]
        }
      );
    }
    const operation = {
      expectedProjectId: args.expectedProjectId,
      expectedRevision: args.expectedRevision,
      operation: 'bind_resource',
      resourceId: resource.id,
      note: args.note || '',
      borrow: args.borrow || '实验设计'
    };
    if (args.target.kind === 'panel') {
      Object.assign(operation, {
        planId: args.target.planId,
        figureId: args.target.figureId,
        panelId: args.target.panelId
      });
    } else if (args.target.kind === 'edge') {
      Object.assign(operation, {
        hypothesisId: args.target.hypothesisId,
        edgeId: args.target.edgeId
      });
    } else {
      Object.assign(operation, {
        hypothesisId: args.target.hypothesisId,
        point: args.target.point || { x: 0, y: 0 }
      });
    }
    const receipt = await bridgeCall({
      name: 'workbench.model_operation',
      bridgeName: 'model_operation'
    }, operation, context);
    return {
      ...receipt,
      resource: {
        id: resource.id,
        type: resource.type,
        title: resource.title,
        source: resource.source || null
      },
      target: clone(args.target)
    };
  }

  async function projectSummary(args, context) {
    const current = await bridgeCall({
      name: READ_CONTEXT,
      bridgeName: 'read_context'
    }, {}, context);
    if (args.expectedProjectId !== undefined &&
        (current.projectId || null) !== args.expectedProjectId) {
      throw new BrevessMcpError(
        'WORKBENCH_AGENT_PROJECT_CHANGED',
        'The active Workbench project does not match expectedProjectId.',
        {
          expectedProjectId: args.expectedProjectId,
          actualProjectId: current.projectId || null
        }
      );
    }
    if (args.expectedRevision !== undefined && current.revision !== args.expectedRevision) {
      throw new BrevessMcpError(
        'WORKBENCH_AGENT_STALE_REVISION',
        'The project revision changed; read the summary again.',
        { expectedRevision: args.expectedRevision, actualRevision: current.revision }
      );
    }
    const project = current.project || {};
    const hypotheses = project.hypotheses || [];
    const plans = project.plans || [];
    const figures = plans.flatMap(plan => plan.figures || []);
    const panels = figures.flatMap(figure => figure.panels || []);
    return {
      projectId: current.projectId,
      revision: current.revision,
      contentRevision: current.contentRevision,
      layoutRevision: current.layoutRevision,
      name: project.name || '',
      question: project.question || '',
      selection: current.selection,
      view: current.view?.view || {},
      counts: {
        hypotheses: hypotheses.length,
        nodes: hypotheses.reduce((sum, h) => sum + (h.nodes?.length || 0), 0),
        edges: hypotheses.reduce((sum, h) => sum + (h.edges?.length || 0), 0),
        plans: plans.length,
        figures: figures.length,
        panels: panels.length,
        resources: (project.resources || []).length,
        assets: (project.assets || []).length,
        pendingReviewPanels: panels.filter(panel => panel.status === 'review').length,
        pendingReviewBindings: hypotheses.reduce((sum, h) => sum + (h.edges || [])
          .reduce((edgeSum, edge) => edgeSum + (edge.bindings || []).filter(b => b.review).length, 0), 0)
      },
      review: {
        hypotheses: hypotheses.filter(h => h.revision > 0).map(h => ({
          id: h.id,
          name: h.name,
          revision: h.revision
        })),
        panels: panels.filter(panel => panel.status === 'review').map(panel => ({
          id: panel.id,
          title: panel.title
        }))
      },
      undo: current.undo || [],
      redo: current.redo || [],
      pendingProposal: current.pendingProposal === true,
      nextActions: [
        { tool: 'workbench.read_context', reason: 'Read full entity data before a field-level edit.' },
        { tool: 'workbench.model_operation', reason: 'Create or arrange project entities with CAS.' }
      ]
    };
  }

  async function execute(name, input = {}, context = {}) {
    const tool = tools.get(name);
    if (!tool) {
      throw new BrevessMcpError('MCP_TOOL_NOT_FOUND', `Unknown tool: ${name}`, {
        field: 'name',
        allowedValues: [...tools.keys()]
      });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BrevessMcpError('MCP_INVALID_ARGUMENTS', 'Tool arguments must be an object.', {
        field: 'arguments'
      });
    }
    const args = clone(input);
    const mutating = writeRequired(tool, args);
    if (HUMAN_CONFIRM_TOOLS.has(name) ||
        name === 'library.local_data' && LOCAL_DATA_MUTATIONS.has(args?.operation)) {
      throw new BrevessMcpError(
        'PENDING_HUMAN_ACTION',
        `${name} requires a per-operation human confirmation in the BREVESS UI.`,
        {
          operation: name,
          requestTool: 'brevess.request_write_scope',
          correction: 'The MCP call did not execute. Open the specific Workbench preview, approve it there, then retry only if the host returns an approval receipt.'
        },
        {
          nextActions: [{
            action: 'human_approval',
            reason: 'Review the concrete Workbench change preview.'
          }]
        }
      );
    }
    validateIdempotency(tool, args);
    if (mutating && !allowWrite) {
      throw new BrevessMcpError(
        'MCP_SCOPE_DENIED',
        'This MCP server is connected in read-only scope.',
        {
          tool: name,
          scope: 'write',
          correction: 'Restart the MCP server with --allow-write after reviewing the client and project scope.'
        }
      );
    }
    const idempotencyKey = args.idempotencyKey;
    delete args.idempotencyKey;
    let scopedContext = context;
    let activeScope = null;
    if (mutating && !tool.name.startsWith('brevess.') && tool.name !== 'library.import_transfer') {
      if (tool.kind === 'contract') projectGuard(args);
      const scope = scopeManager.require(args.expectedProjectId, name, hostOperationNames(name));
      activeScope = scope;
      scopedContext = { ...context, scopeToken: scope.hostToken };
    }
    let data;
    if (tool.kind === 'control') {
      if (name === 'brevess.request_write_scope') data = await requestWriteScope(args, context);
      else if (name === 'brevess.revoke_write_scope') data = await revokeWriteScope(args, context);
      else if (name === 'brevess.status') data = await hostStatus(context);
      else if (name === 'brevess.capabilities') data = await hostCapabilities(args, context);
      else throw new BrevessMcpError('MCP_TOOL_NOT_IMPLEMENTED', `No implementation for ${name}`);
    } else if (tool.kind === 'contract') {
      data = await bridgeCall(tool, args, scopedContext);
    } else if (tool.kind === 'high-level') {
      if (name === 'workbench.plan_hypotheses') data = await planHypotheses(args, scopedContext);
      else if (name === 'workbench.plan_figures') data = await planFigures(args, scopedContext);
      else if (name === 'library.import_and_bind') data = await importAndBind(args, scopedContext);
      else if (name === 'workbench.project_summary') data = await projectSummary(args, scopedContext);
      else if (name === 'workbench.read_more') {
        if (!scopedContext.resultCache || typeof scopedContext.resultCache.read !== 'function') {
          throw new BrevessMcpError('RESULT_CACHE_UNAVAILABLE', 'No result cache is attached to this server.');
        }
        data = scopedContext.resultCache.read(args.cursor, args.offsetBytes, args.maxBytes);
      }
      else throw new BrevessMcpError('MCP_TOOL_NOT_IMPLEMENTED', `No implementation for ${name}`);
    } else {
      data = await bridgeCall(tool, args, scopedContext);
    }
    if (activeScope?.bootstrap === true && name === 'workbench.create_project') {
      scopeManager.consume(activeScope.scopeId);
    }
    const receipt = receiptFrom(data);
    const output = {
      ok: true,
      data: stripSecretFields(data),
      ...(receipt ? { receipt } : {}),
      ...(data && typeof data === 'object' && data.createdId !== undefined
        ? { createdId: data.createdId }
        : {}),
      ...(data && typeof data === 'object' && data.createdIds !== undefined
        ? { createdIds: data.createdIds }
        : {}),
      warnings: [],
      changedPaths: inferChangedPaths(name, args, data),
      nextActions: nextActions(name, mutating)
    };
    if (mutating && !idempotencyKey) output.warnings.push('Write executed without an idempotency key.');
    return output;
  }

  function receiptFrom(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const keys = [
      'projectId',
      'revision',
      'contentRevision',
      'layoutRevision',
      'createdId',
      'createdIds',
      'recycleId',
      'linkId',
      'blockId',
      'edgeId',
      'deleted',
      'status',
      'operation',
      'resourceId'
    ];
    const receipt = Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
    return Object.keys(receipt).length ? receipt : null;
  }

  function inferChangedPaths(name, args, data) {
    if (!args || !data) return [];
    if (name === 'workbench.plan_hypotheses' && data.createdIds?.hypothesisId) {
      return [`projects/${args.expectedProjectId}/hypotheses/${data.createdIds.hypothesisId}`];
    }
    if (name === 'workbench.plan_figures' && data.createdIds?.planId) {
      return [`projects/${args.expectedProjectId}/plans/${data.createdIds.planId}`];
    }
    if (name === 'library.import_and_bind') {
      return [
        `projects/${args.expectedProjectId}/resources`,
        `projects/${args.expectedProjectId}/${args.target?.kind || 'binding'}`
      ];
    }
    if (name === 'workbench.attach_material') {
      return [
        `projects/${args.expectedProjectId}/materialLinks`,
        `projects/${args.expectedProjectId}/materialLinks/${data.linkId || 'new'}`
      ];
    }
    if (name === 'workbench.update_material_stance') {
      return [`projects/${args.expectedProjectId}/materialLinks/${args.linkId}`];
    }
    if (name === 'workbench.create_evidence_block') {
      return [
        `projects/${args.expectedProjectId}/plans/${args.planId}/figures/${args.figureId}/evidenceBlocks`,
        ...(data.blockId ? [`projects/${args.expectedProjectId}/plans/${args.planId}/figures/${args.figureId}/evidenceBlocks/${data.blockId}`] : [])
      ];
    }
    if (name === 'workbench.set_edge_relation') {
      return [
        `projects/${args.expectedProjectId}/hypotheses/${args.hypothesisId}/edges/${args.edgeId}`,
        `projects/${args.expectedProjectId}/hypotheses/${args.hypothesisId}/edges/${args.edgeId}/kind`
      ];
    }
    if (name === 'workbench.create_project' && data.createdId) return [`projects/${data.createdId}`];
    if (name === 'workbench.edit_project') {
      return [`projects/${args.expectedProjectId}`, ...(args.operations || []).slice(0, 20).map(op =>
        `projects/${args.expectedProjectId}/${(op.path || []).map(part =>
          typeof part === 'string' ? part : part.id).join('/')}`) ];
    }
    if (name === 'workbench.remove_entity') {
      return [`projects/${args.expectedProjectId}/${args.kind}/${args.id}`];
    }
    if (name === 'workbench.restore') {
      return [`projects/${args.expectedProjectId}/recycle/${args.recycleId}`];
    }
    if (name === 'workbench.import_project') return ['projects'];
    if (name === 'workbench.import_asset') return [`projects/${args.expectedProjectId}/assets`];
    if (name === 'workbench.data_directory') {
      return [`projects/${args.expectedProjectId}/directories/${args.target?.kind || 'project'}`];
    }
    if (name === 'library.local_data') {
      return [`workspaces/${args.workspaceId || args.query || 'query'}`];
    }
    if (name.startsWith('radar.')) {
      return [`radars/${args.id || data.id || 'new'}`];
    }
    if (name === 'workbench.model_operation') {
      return [`projects/${args.expectedProjectId}/${args.operation}`];
    }
    if (name === 'workbench.save_view' || name === 'workbench.navigate') {
      return [`projects/${args.expectedProjectId}/views`];
    }
    return [];
  }

  function nextActions(name, mutating) {
    if (name === 'brevess.request_write_scope') {
      return [
        { tool: 'brevess.status', reason: 'Check whether the human approved the scope.' },
        { tool: 'workbench.read_context', reason: 'Refresh the project revision before the scoped write.' }
      ];
    }
    if (name === 'brevess.status') {
      return [{ tool: 'brevess.capabilities', reason: 'Inspect available Workbench operations and approval classes.' }];
    }
    if (name === 'brevess.capabilities') {
      return [{ tool: 'workbench.read_context', reason: 'Read the current project before selecting an operation.' }];
    }
    if (name === 'workbench.read_context') {
      return [
        { tool: 'workbench.project_summary', reason: 'Get a compact overview before planning.' },
        { tool: 'workbench.plan_hypotheses', reason: 'Create a hypothesis graph.' },
        { tool: 'workbench.plan_figures', reason: 'Create a figure plan.' }
      ];
    }
    if (name === 'workbench.project_summary') {
      return [{ tool: 'workbench.read_context', reason: 'Read the full project before field edits.' }];
    }
    if (name === 'library.query_library' || name === 'library.query_global_library') {
      return [{ tool: 'library.read_workspace', reason: 'Read a selected saved workspace version.' }];
    }
    if (name === 'workbench.plan_hypotheses') {
      return [
        { tool: 'library.import_and_bind', reason: 'Bind evidence to the created hypothesis or edges.' },
        { tool: 'workbench.read_context', reason: 'Read the new IDs and revision.' }
      ];
    }
    if (name === 'workbench.plan_figures') {
      return [
        { tool: 'workbench.model_operation', reason: 'Arrange, link or update Panel content with a CAS guard.' },
        { tool: 'workbench.read_context', reason: 'Read the new IDs and revision.' }
      ];
    }
    if (name === 'library.import_and_bind') {
      return [{ tool: 'workbench.read_context', reason: 'Verify the binding and update the plan.' }];
    }
    if (mutating) {
      return [{ tool: 'workbench.read_context', reason: 'Read the updated revision before the next write.' }];
    }
    return [];
  }

  function tool(name) {
    return tools.get(name) || null;
  }

  return {
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
    toolContractVersion: MCP_TOOL_CONTRACT_VERSION,
    operationContractVersion: WORKBENCH_OPERATION_CONTRACT_VERSION,
    allowWrite,
    scopeManager,
    list,
    execute,
    tool,
    writeRequired
  };
}

module.exports = {
  SERVER_NAME,
  SERVER_VERSION,
  MCP_TOOL_CONTRACT_VERSION,
  WORKBENCH_OPERATION_CONTRACT_VERSION,
  createRegistry,
  directToolName
};
