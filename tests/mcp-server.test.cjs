const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const { BridgeHub } = require('../mcp/lib/bridge-hub.js');
const { createRegistry } = require('../mcp/lib/registry.js');
const { McpProtocol, ResultCache } = require('../mcp/lib/protocol.js');
const { WriteScopeManager } = require('../mcp/lib/scopes.js');
const { start, extensionIdFromKey } = require('../mcp/server.js');

const TOKEN = 'test-token-0123456789-abcdefghijklmnopqrstuvwxyz';
const META = {
  clientId: 'workbench-test-1234',
  name: 'Test Workbench',
  extensionVersion: '1.0.1',
  protocolVersion: 1,
  platform: 'test'
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mcp-test-'));
}

function bridgeHeaders(token = TOKEN) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json'
  };
}

test('bridge hub enforces token, protocol and one active request', async () => {
  const hub = new BridgeHub({ token: TOKEN, toolTimeoutMs: 5000 });
  assert.throws(() => hub.authorize('wrong'), { code: 'BRIDGE_UNAUTHORIZED' });
  const pendingPoll = hub.poll(META);
  const call = hub.call('read_context', {}, { mcpRequestId: 'r1', timeoutMs: 5000 });
  const job = await pendingPoll;
  assert.equal(job.type, 'call');
  assert.equal(job.name, 'read_context');
  let secondResolved = false;
  const second = hub.call('list_projects', {}, { mcpRequestId: 'r2', timeoutMs: 5000 }).then(value => {
    secondResolved = true;
    return value;
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(secondResolved, false);
  hub.result(job.requestId, { success: true, result: { projectId: 'p1', revision: 1 } });
  assert.deepEqual(await call, { projectId: 'p1', revision: 1 });
  const nextPoll = hub.poll(META);
  const secondJob = await nextPoll;
  assert.equal(secondJob.name, 'list_projects');
  hub.result(secondJob.requestId, { success: true, result: [] });
  assert.deepEqual(await second, []);
  hub.close();
});

test('bridge version mismatch fails closed before dispatching work', async () => {
  const hub = new BridgeHub({ token: TOKEN });
  assert.throws(() => hub.poll({ ...META, protocolVersion: 2 }), { code: 'BRIDGE_VERSION_MISMATCH' });
  assert.throws(() => hub.call('read_context', {}), { code: 'BRIDGE_UNAVAILABLE' });
  hub.close();
});

test('protocol initialize, tools/list and resources work without a bridge', async () => {
  const hub = new BridgeHub({ token: TOKEN, connectUrl: 'http://127.0.0.1:9537/connect?token=x' });
  const registry = createRegistry({ hub, allowWrite: false });
  const protocol = new McpProtocol({ registry, hub, connectUrl: hub.connectUrl });
  const initialized = await protocol.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test' } }
  });
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  assert.match(initialized.result.instructions, /read only/);
  const listed = await protocol.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.ok(listed.result.tools.length >= 30);
  assert.ok(listed.result.tools.every(tool =>
    /^(workbench|library|pdf|figure|radar|settings|brevess)\./u.test(tool.name)));
  assert.ok(listed.result.tools.some(tool => tool.name === 'workbench.model_operation'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'radar.list'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'workbench.plan_hypotheses'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'library.export_transfer'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'library.import_transfer'));
  const resources = await protocol.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
  assert.ok(resources.result.resources.some(row => row.uri === 'brevess://health'));
  const health = await protocol.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'resources/read',
    params: { uri: 'brevess://health' }
  });
  const value = JSON.parse(health.result.contents[0].text);
  assert.deepEqual(value.scopes, ['read']);
  assert.equal(value.bridge.online, false);
  hub.close();
});

test('tool calls preserve bridge errors and read-only scope', async () => {
  let calls = 0;
  const hub = {
    call: async () => {
      calls += 1;
      return { projectId: 'p', revision: 1 };
    },
    cancel: () => ({ cancelled: false }),
    status: () => ({ online: true })
  };
  const registry = createRegistry({ hub, allowWrite: false });
  const protocol = new McpProtocol({ registry, hub });
  const denied = await protocol.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'workbench.edit_project',
      arguments: {
        expectedProjectId: 'p',
        expectedRevision: 1,
        idempotencyKey: 'write-key-1',
        operations: [{ op: 'set', path: ['name'], value: 'x' }]
      }
    }
  });
  assert.equal(denied.result.isError, true);
  assert.equal(denied.result.structuredContent.error.code, 'MCP_SCOPE_DENIED');
  assert.equal(calls, 0);
  const read = await protocol.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'workbench.read_context', arguments: {} }
  });
  assert.equal(read.result.isError, undefined);
  assert.equal(read.result.structuredContent.data.revision, 1);
  assert.equal(calls, 1);
});

test('write calls require idempotency and cache repeated logical writes', async () => {
  let calls = 0;
  const hub = {
    call: async () => {
      calls += 1;
      return { projectId: 'p', revision: 2, createdId: 'h1' };
    },
    cancel: () => ({ cancelled: false }),
    status: () => ({ online: true })
  };
  const scopeManager = new WriteScopeManager();
  scopeManager.applyHostResult({
    status: 'GRANTED',
    scopeToken: 'fake-host-write-token',
    projectId: null,
    operations: ['workbench.create_project'],
    expiresAt: Date.now() + 60000
  }, {
    projectId: null,
    operations: ['workbench.create_project'],
    ttlMs: 60000
  });
  const registry = createRegistry({ hub, allowWrite: true, scopeManager });
  const protocol = new McpProtocol({ registry, hub });
  const missing = await protocol.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'workbench.create_project',
      arguments: { expectedProjectId: null, expectedRevision: 0, name: 'New' }
    }
  });
  assert.equal(missing.result.structuredContent.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const args = {
    expectedProjectId: null,
    expectedRevision: 0,
    name: 'New',
    idempotencyKey: 'project-create-0001'
  };
  const first = await protocol.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'workbench.create_project', arguments: args }
  });
  const second = await protocol.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'workbench.create_project', arguments: args }
  });
  assert.equal(first.result.structuredContent.data.createdId, 'h1');
  assert.deepEqual(second.result.structuredContent, first.result.structuredContent);
  assert.equal(calls, 1);
  const reused = await protocol.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'workbench.create_project',
      arguments: { ...args, name: 'Different' }
    }
  });
  assert.equal(reused.error.data.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('high-level hypothesis planning composes model operations and returns actual IDs', async () => {
  const calls = [];
  let revision = 3;
  const hub = {
    call: async (name, args) => {
      calls.push({ name, args });
      revision += 1;
      if (args.operation === 'create_hypothesis') return { projectId: 'p', revision, createdId: 'h1' };
      if (args.operation === 'create_node') return { projectId: 'p', revision, createdId: `n${calls.length}` };
      if (args.operation === 'create_edge') return { projectId: 'p', revision, createdId: 'e1' };
      throw new Error(`unexpected model operation ${args.operation}`);
    },
    cancel: () => ({ cancelled: false }),
    status: () => ({ online: true })
  };
  const scopeManager = new WriteScopeManager();
  scopeManager.applyHostResult({
    status: 'GRANTED',
    scopeToken: 'fake-host-write-token',
    projectId: 'p',
    operations: ['create_hypothesis', 'create_node', 'create_edge'],
    expiresAt: Date.now() + 60000
  }, {
    projectId: 'p',
    operations: ['create_hypothesis', 'create_node', 'create_edge'],
    ttlMs: 60000
  });
  const registry = createRegistry({ hub, allowWrite: true, scopeManager });
  const result = await registry.execute('workbench.plan_hypotheses', {
    expectedProjectId: 'p',
    expectedRevision: 3,
    idempotencyKey: 'hypothesis-plan-1',
    name: 'Test hypothesis',
    nodes: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B', point: { x: 100, y: 200 } }
    ],
    edges: [{ from: 'a', to: 'b', claim: 'A drives B' }]
  });
  assert.deepEqual(calls.map(call => call.args.operation), [
    'create_hypothesis', 'create_node', 'create_node', 'create_edge'
  ]);
  assert.equal(calls[0].name, 'create_hypothesis');
  assert.deepEqual(calls.map(call => call.args.expectedRevision), [3, 4, 5, 6]);
  assert.equal(result.createdIds.nodes.length, 2);
  assert.equal(result.createdIds.edges.length, 1);
  assert.equal(result.receipt.revision, 7);
  assert.ok(result.changedPaths[0].includes(result.createdIds.hypothesisId));
});

test('task write scope is pending, human-granted, used by the host, and revocable', async () => {
  let hostCalls = 0;
  let rewriteCalls = 0;
  let lastOptions;
  const hub = {
    call: async (name, args, options) => {
      hostCalls += 1;
      if (name === 'brevess.request_write_scope') {
        rewriteCalls += 1;
        if (!args.approvalId) {
          return {
            status: 'PENDING_HUMAN_ACTION',
            approvalId: 'approval-1',
            expiresAt: Date.now() + 120000,
            preview: { operations: args.operations, reason: args.reason }
          };
        }
        return {
          success: true,
          data: {
            status: 'GRANTED',
            token: 'host-only-scope-token',
            scopeId: 'scope-1',
            projectId: 'p',
            operations: args.operations,
            expiresAt: Date.now() + 60000
          }
        };
      }
      if (name === 'brevess.revoke_write_scope') return { revoked: true };
      if (name === 'brevess.status') return { ready: true, projectId: 'p', revision: 1 };
      lastOptions = options;
      return { projectId: 'p', revision: 2, linkId: 'link-1' };
    },
    cancel: () => ({ cancelled: false }),
    status: () => ({ online: true })
  };
  const registry = createRegistry({ hub, allowWrite: true });
  assert.match(registry.tool('workbench.create_project').description, /bootstrap/u);
  const protocol = new McpProtocol({ registry, hub });
  const requestArgs = {
    projectId: 'p',
    operations: ['workbench.attach_material'],
    reason: 'Bind two verified figures',
    ttlMs: 120000,
    taskId: 'task-1'
  };
  const pending = await protocol.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'brevess.request_write_scope', arguments: requestArgs }
  });
  assert.equal(pending.result.structuredContent.data.status, 'PENDING_HUMAN_ACTION');
  assert.equal(pending.result.structuredContent.data.approvalId, 'approval-1');
  assert.equal(rewriteCalls, 1);
  const granted = await protocol.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'brevess.request_write_scope',
      arguments: { ...requestArgs, approvalId: 'approval-1' }
    }
  });
  const grantedText = JSON.stringify(granted.result.structuredContent);
  assert.equal(granted.result.structuredContent.data.granted, true);
  assert.doesNotMatch(grantedText, /host-only-scope-token/);
  const write = await protocol.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'workbench.attach_material',
      arguments: {
        expectedProjectId: 'p',
        expectedRevision: 1,
        idempotencyKey: 'attach-material-1',
        hypothesisId: 'hypothesis_1',
        targetType: 'node',
        targetId: 'node_1',
        materialType: 'figure',
        sourceKind: 'library',
        resourceId: 'resource_1',
        stance: 'support',
        note: 'verified'
      }
    }
  });
  assert.equal(write.result.structuredContent.data.linkId, 'link-1');
  assert.equal(lastOptions.hostOptions.scopeToken, 'host-only-scope-token');
  const revoked = await protocol.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'brevess.revoke_write_scope', arguments: { scopeId: 'scope-1' } }
  });
  assert.equal(revoked.result.structuredContent.data.revoked, true);
  const denied = await protocol.handle({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'workbench.attach_material',
      arguments: {
        expectedProjectId: 'p',
        expectedRevision: 2,
        idempotencyKey: 'attach-material-2',
        hypothesisId: 'hypothesis_1',
        targetType: 'node',
        targetId: 'node_1',
        materialType: 'figure',
        sourceKind: 'library',
        resourceId: 'resource_2',
        stance: 'support'
      }
    }
  });
  assert.equal(denied.result.structuredContent.error.code, 'MCP_WRITE_SCOPE_REQUIRED');
  assert.ok(hostCalls >= 4);
});

test('empty Workbench bootstrap creates a project without inventing a projectId', async () => {
  let bootstrapCalls = 0;
  let createCalls = 0;
  const hub = {
    call: async (name, args, options) => {
      if (name === 'brevess.request_write_scope') {
        bootstrapCalls += 1;
        assert.equal(args.projectId, null);
        assert.equal(args.bootstrap, true);
        assert.deepEqual(args.operations, ['create_project']);
        if (!args.approvalId) {
          return {
            status: 'PENDING_HUMAN_ACTION',
            approvalId: 'bootstrap-approval-1',
            expiresAt: Date.now() + 120000,
            bootstrap: true
          };
        }
        return {
          success: true,
          data: {
            status: 'GRANTED',
            token: 'bootstrap-only-token',
            scopeId: 'bootstrap-scope-1',
            projectId: null,
            bootstrap: true,
            operations: ['create_project'],
            expiresAt: Date.now() + 60000
          }
        };
      }
      if (name === 'create_project') {
        createCalls += 1;
        assert.equal(args.expectedProjectId, null);
        assert.equal(args.expectedRevision, 0);
        assert.equal(options.hostOptions.scopeToken, 'bootstrap-only-token');
        return { projectId: 'project-created-1', revision: 1, createdId: 'project-created-1' };
      }
      throw new Error(`unexpected bridge operation ${name}`);
    },
    cancel: () => ({ cancelled: false }),
    status: () => ({ online: true })
  };
  const registry = createRegistry({ hub, allowWrite: true });
  const protocol = new McpProtocol({ registry, hub });
  const request = {
    projectId: null,
    bootstrap: true,
    operations: ['workbench.create_project'],
    reason: 'Create the first project',
    ttlMs: 60000,
    taskId: 'bootstrap-task'
  };
  const pending = await protocol.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'brevess.request_write_scope', arguments: request }
  });
  assert.equal(pending.result.structuredContent.data.status, 'PENDING_HUMAN_ACTION');
  assert.equal(pending.result.structuredContent.data.bootstrap, true);
  const granted = await protocol.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'brevess.request_write_scope',
      arguments: { ...request, approvalId: 'bootstrap-approval-1' }
    }
  });
  assert.equal(granted.result.structuredContent.data.status, 'GRANTED');
  assert.equal(granted.result.structuredContent.data.scope.bootstrap, true);
  const created = await protocol.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'workbench.create_project',
      arguments: {
        expectedProjectId: null,
        expectedRevision: 0,
        name: 'First project',
        idempotencyKey: 'bootstrap-create-project-1'
      }
    }
  });
  assert.equal(created.result.structuredContent.data.createdId, 'project-created-1');
  assert.equal(created.result.structuredContent.receipt.revision, 1);
  assert.equal(bootstrapCalls, 2);
  assert.equal(createCalls, 1);
  assert.equal(registry.scopeManager.status().granted, false);
});

test('empty Workbench bootstrap then read_context and hypothesis planning use the real project ID', async () => {
  let bootstrapRequests = 0;
  let planCalls = 0;
  const hub = {
    call: async (name, args, options) => {
      if (name === 'brevess.request_write_scope') {
        bootstrapRequests += 1;
        if (!args.approvalId) {
          return {
            status: 'PENDING_HUMAN_ACTION',
            approvalId: 'bootstrap-sequence-approval',
            expiresAt: Date.now() + 120000,
            bootstrap: true
          };
        }
        return {
          success: true,
          data: {
            status: 'GRANTED',
            token: 'bootstrap-sequence-token',
            scopeId: 'bootstrap-sequence-scope',
            projectId: null,
            bootstrap: true,
            operations: ['create_project'],
            expiresAt: Date.now() + 60000
          }
        };
      }
      if (name === 'create_project') {
        assert.equal(args.expectedProjectId, null);
        assert.equal(args.expectedRevision, 0);
        assert.deepEqual(options.hostOptions, { scopeToken: 'bootstrap-sequence-token' });
        return { projectId: 'project-sequence-real', revision: 1, createdId: 'project-sequence-real' };
      }
      if (name === 'read_context') {
        return {
          projectId: 'project-sequence-real',
          revision: 1,
          project: { id: 'project-sequence-real', name: 'Sequence project', hypotheses: [], plans: [] }
        };
      }
      if (['create_hypothesis', 'create_node', 'create_edge'].includes(name)) {
        planCalls += 1;
        assert.equal(args.expectedProjectId, 'project-sequence-real');
        assert.equal(args.expectedRevision, planCalls);
        if (name === 'create_hypothesis') return { projectId: 'project-sequence-real', revision: 2, createdId: 'hypothesis-sequence' };
        if (name === 'create_node') return { projectId: 'project-sequence-real', revision: planCalls + 1, createdId: `node-sequence-${planCalls}` };
        if (name === 'create_edge') return { projectId: 'project-sequence-real', revision: planCalls + 1, createdId: `edge-sequence-${planCalls}` };
      }
      throw new Error(`unexpected bridge operation ${name}`);
    },
    cancel: () => ({ cancelled: false }),
    status: () => ({ online: true })
  };
  const registry = createRegistry({ hub, allowWrite: true });
  const protocol = new McpProtocol({ registry, hub });
  const pending = await protocol.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'brevess.request_write_scope',
      arguments: {
        projectId: null,
        bootstrap: true,
        operations: ['workbench.create_project'],
        ttlMs: 60000
      }
    }
  });
  assert.equal(pending.result.structuredContent.data.status, 'PENDING_HUMAN_ACTION');
  const granted = await protocol.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'brevess.request_write_scope',
      arguments: {
        projectId: null,
        bootstrap: true,
        operations: ['workbench.create_project'],
        ttlMs: 60000,
        approvalId: 'bootstrap-sequence-approval'
      }
    }
  });
  assert.equal(granted.result.structuredContent.data.scope.bootstrap, true);
  const created = await protocol.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'workbench.create_project',
      arguments: {
        expectedProjectId: null,
        expectedRevision: 0,
        name: 'Sequence project',
        idempotencyKey: 'sequence-create-project'
      }
    }
  });
  assert.equal(created.result.structuredContent.data.createdId, 'project-sequence-real');
  assert.equal(created.result.structuredContent.receipt.revision, 1);
  const context = await protocol.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'workbench.read_context', arguments: {} }
  });
  assert.equal(context.result.structuredContent.data.projectId, 'project-sequence-real');
  registry.scopeManager.applyHostResult({
    status: 'GRANTED',
    token: 'normal-sequence-token',
    scopeId: 'normal-sequence-scope',
    projectId: 'project-sequence-real',
    operations: ['create_hypothesis', 'create_node', 'create_edge'],
    expiresAt: Date.now() + 60000
  }, {
    projectId: 'project-sequence-real',
    operations: ['create_hypothesis', 'create_node', 'create_edge'],
    ttlMs: 60000
  });
  const planned = await protocol.handle({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'workbench.plan_hypotheses',
      arguments: {
        expectedProjectId: 'project-sequence-real',
        expectedRevision: 1,
        name: 'Branching hypothesis',
        nodes: [
          { key: 'upstream', label: '上游刺激' },
          { key: 'main', label: '主通路' },
          { key: 'branch', label: '条件旁路' }
        ],
        edges: [
          { from: 'upstream', to: 'main', claim: '主线激活' },
          { from: 'upstream', to: 'branch', claim: '条件分支' }
        ],
        idempotencyKey: 'sequence-plan-hypothesis'
      }
    }
  });
  assert.equal(planned.result.structuredContent.receipt.revision, 7);
  assert.equal(planned.result.structuredContent.createdIds.nodes.length, 3);
  assert.equal(planCalls, 6);
  assert.equal(bootstrapRequests, 2);
});

test('large results are paged through cursors and read_more', async () => {
  const cache = new ResultCache({ maxBytes: 4096 });
  const put = cache.put({ ok: true, data: { text: 'x'.repeat(12000) } });
  assert.equal(put.truncated, true);
  const first = cache.read(put.value.cursor, 0, 2000);
  assert.equal(first.returnedBytes, 2000);
  assert.ok(first.nextOffset > 0);
  assert.equal(first.chunk.length, 2000);
});

test('pdf.open_local uses the dedicated Workbench PDF route and stays read-only', async () => {
  let captured;
  const hub = {
    call: async (name, args) => {
      captured = { name, args };
      return {
        documentId: 'pdf-doc-1',
        documentHash: 'a'.repeat(64),
        title: 'Fixture article',
        doi: '10.0000/fixture',
        pageCount: 45,
        referenceCount: 97,
        outline: []
      };
    },
    cancel: () => ({ cancelled: false }),
    status: () => ({ online: true })
  };
  const registry = createRegistry({ hub, allowWrite: false });
  const result = await registry.execute('pdf.open_local', {
    fileUrl: 'file:///C:/papers/fixture.pdf'
  });
  assert.equal(captured.name, 'open_local_pdf');
  assert.deepEqual(captured.args, { fileUrl: 'file:///C:/papers/fixture.pdf' });
  assert.equal(result.data.pageCount, 45);
  assert.equal(result.data.referenceCount, 97);
});

test('localhost HTTP MCP and bridge exchange a real tools/call roundtrip', async t => {
  const dir = tempDir();
  const instance = await start({
    port: 0,
    host: '127.0.0.1',
    transport: 'http',
    allowWrite: false,
    token: TOKEN,
    stateDir: dir,
    tokenFile: path.join(dir, 'token'),
    auditFile: path.join(dir, 'audit.ndjson'),
    toolTimeoutMs: 10000,
    maxResultBytes: 700000
  });
  t.after(async () => {
    await instance.close(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const health = await fetch(`${instance.baseUrl}/health`);
  assert.equal(health.status, 200);
  const initialized = await fetch(`${instance.baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      ...bridgeHeaders(),
      accept: 'text/event-stream, application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    })
  });
  assert.equal(initialized.status, 202);
  const initializedRequest = await fetch(`${instance.baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      ...bridgeHeaders(),
      accept: 'text/event-stream, application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'accept-both' } }
    })
  });
  assert.equal(initializedRequest.status, 200);
  assert.match(initializedRequest.headers.get('content-type') || '', /application\/json/u);
  assert.equal((await initializedRequest.json()).result.protocolVersion, '2025-06-18');
  const pollPromise = fetch(`${instance.baseUrl}/bridge/poll`, {
    method: 'POST',
    headers: bridgeHeaders(),
    body: JSON.stringify(META)
  }).then(response => response.json());
  await new Promise(resolve => setTimeout(resolve, 50));
  const callPromise = fetch(`${instance.baseUrl}/mcp`, {
    method: 'POST',
    headers: bridgeHeaders(),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'workbench.read_context', arguments: {} }
    })
  }).then(response => response.json());
  const job = await pollPromise;
  assert.equal(job.type, 'call');
  assert.equal(job.name, 'read_context');
  const resultResponse = await fetch(`${instance.baseUrl}/bridge/result`, {
    method: 'POST',
    headers: bridgeHeaders(),
    body: JSON.stringify({
      requestId: job.requestId,
      success: true,
      result: {
        projectId: 'project_1',
        revision: 7,
        contentRevision: 2,
        layoutRevision: 1,
        project: { id: 'project_1', name: 'HTTP project', hypotheses: [], plans: [] },
        selection: {},
        view: { revision: 0, view: {} },
        undo: [],
        redo: []
      }
    })
  });
  assert.equal(resultResponse.status, 200);
  const result = await callPromise;
  assert.equal(result.result.structuredContent.data.project.name, 'HTTP project');
  assert.equal(result.result.structuredContent.receipt.revision, 7);
  const audit = fs.readFileSync(path.join(dir, 'audit.ndjson'), 'utf8');
  assert.match(audit, /workbench.read_context/);
  assert.doesNotMatch(audit, new RegExp(TOKEN));
});

test('stdio MCP handshake returns initialize and tools/list in one process', async t => {
  const dir = tempDir();
  const child = spawn(process.execPath, [
    path.join(__dirname, '..', 'mcp', 'server.js'),
    '--stdio-only',
    '--port', '0',
    '--token', TOKEN,
    '--state-dir', dir
  ], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  t.after(() => {
    try { child.kill(); } catch { /* already exited */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const output = [];
  lines.on('line', line => output.push(JSON.parse(line)));
  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 'stdio-init',
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', clientInfo: { name: 'stdio-test' } }
  })}\n`);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 'stdio-list',
    method: 'tools/list',
    params: {}
  })}\n`);
  const deadline = Date.now() + 5000;
  while (output.length < 2 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(output[0].id, 'stdio-init');
  assert.equal(output[0].result.protocolVersion, '2025-06-18');
  assert.equal(output[1].id, 'stdio-list');
  assert.ok(output[1].result.tools.some(tool => tool.name === 'workbench.read_context'));
  child.stdin.end();
});

test('extension ID derivation matches Chrome extension ID mapping', () => {
  const key = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA+B4vL4I4bJQVURPfrGIV4YjSJ5h0NQBP3NY72ZyN26DX0ffpmTMlRpc1DKaNj21pjN46/Ig1MYu2b3ReoBdQKgzrKMDPACu1GoOOnF37ei79fJXPCovCaMRBXQrEYgsaYCf6RmTlkU98qQQjV6o211akZO0l7Ba4OrNQzUzULFP+AF88rl45cpjRtVFgsM6/duDnnQVWWCaKv1nLtvJvNRfO2AsydO0354f/iI3Ikirpx61xxWP0y/6uElWsqGI6Sm135IG8E+ahF4juNciziGmX+cgRDz2QN+KAdxL2GVewdmTU5AHC2/r9N5kf5JQkvYKb+5Ar0nLQBb31/ChmEQIDAQAB';
  assert.match(extensionIdFromKey(key), /^[a-p]{32}$/u);
});
