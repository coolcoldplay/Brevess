'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const registry = require('../workbench/operation-registry.js');

function runtimeFixture() {
  let row = null;
  const calls = [];
  const ui = { audit: [], writeScope: null, bootstrapScope: null };
  const tools = {
    definitions: [
      { name: 'create_project', inputSchema: { type: 'object', properties: { expectedProjectId: {}, expectedRevision: {}, name: {}, question: {} } } },
      { name: 'read_context', inputSchema: { type: 'object', properties: {} } },
      { name: 'edit_project', inputSchema: { type: 'object', properties: { expectedProjectId: {}, expectedRevision: {}, operations: {} } } },
      { name: 'model_operation', inputSchema: { type: 'object', properties: { expectedProjectId: {}, expectedRevision: {}, operation: {} } } },
      { name: 'radar_save', inputSchema: { type: 'object', properties: { expectedEditVersion: {}, config: {} } } }
    ],
    async execute(name, args) {
      calls.push({ name, args: structuredClone(args || {}) });
      if (name === 'create_project') {
        row = {
          id: 'project-real',
          revision: 1,
          project: { id: 'project-real', name: args.name, question: args.question || '', hypotheses: [], plans: [], resources: [], assets: [], materialLinks: [] }
        };
        return { createdId: row.id };
      }
      if (!row) throw Object.assign(new Error('no project'), { code: 'WORKBENCH_PROJECT_NOT_FOUND' });
      if (name === 'read_context') return { projectId: row.id, revision: row.revision, project: structuredClone(row.project) };
      if (name === 'model_operation') {
        row.revision += 1;
        return { createdId: 'hypothesis-real', revision: row.revision, operation: args.operation };
      }
      if (name === 'edit_project') {
        row.revision += 1;
        return { revision: row.revision };
      }
      if (name === 'radar_save') {
        return { id: 'radar-real', editVersion: 2 };
      }
      throw Object.assign(new Error('unknown fake tool'), { code: 'FAKE_TOOL_UNKNOWN' });
    }
  };
  const rt = {
    session: { state: { get row() { return row; } } },
    project: () => row?.project || null,
    sel: () => ({ mode: 'overview' }),
    ui,
    libraryTransfer: {
      async export(args) {
        calls.push({ name: 'library-transfer-export', args: structuredClone(args || {}) });
        return { schema: 'brevess-library-transfer-v1', version: 1, kind: args?.scope === 'global-library' ? 'global-library' : 'radar', generatedAt: new Date().toISOString(), payload: { radars: [], entries: [] } };
      },
      async import(bundle) {
        calls.push({ name: 'library-transfer-import', args: structuredClone(bundle || {}) });
        return { kind: bundle.kind || 'radar', summary: { created: 1, matched: 0 }, warnings: [], conflicts: [], transferRevision: 1 };
      }
    },
    render() {},
    modal(_title, _html, open) {
      const buttons = new Map();
      const dialog = {
        close() {},
        addEventListener() {},
        querySelector(selector) {
          if (!buttons.has(selector)) buttons.set(selector, {});
          return buttons.get(selector);
        }
      };
      open(dialog);
      (buttons.get('[data-scope-allow]') || buttons.get('[data-transfer-allow]')).onclick();
    }
  };
  return { rt, tools, ui, calls, setRow(value) { row = value; } };
}

function loadHost(fixture) {
  const context = {
    crypto: globalThis.crypto,
    console,
    Date,
    structuredClone,
    setTimeout,
    clearTimeout,
    document: { getElementById: () => ({}) },
    dispatchEvent() {},
    removeEventListener() {},
    addEventListener() {}
  };
  context.globalThis = context;
  context.BrevessWorkbenchOperations = registry;
  context.__workbenchRuntime = fixture.rt;
  context.__workbenchTools = fixture.tools;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../workbench/mcp-host.js'), 'utf8'),
    context,
    { filename: 'workbench/mcp-host.js' }
  );
  return context;
}

test('bootstrap confirmation creates the first project and exposes the real ID', async () => {
  const fixture = runtimeFixture();
  const context = loadHost(fixture);
  const mcp = context.BrevessWorkbenchMCP;
  assert.equal(typeof mcp.requestBootstrapScope, 'function');
  assert.equal(typeof mcp.legacyExecute, 'function');

  const before = await mcp.execute('create_project', {
    expectedProjectId: null,
    expectedRevision: 0,
    name: 'First project'
  });
  assert.equal(before.success, false);
  assert.equal(before.error.code, 'WRITE_SCOPE_REQUIRED');
  assert.equal(fixture.calls.length, 0);

  const scope = await mcp.requestBootstrapScope({ taskId: 'bootstrap-test', ttlMs: 60000 });
  assert.equal(scope.success, true);
  assert.equal(scope.data.bootstrap, true);
  assert.equal(scope.data.projectId, null);
  const created = await mcp.execute('create_project', {
    expectedProjectId: null,
    expectedRevision: 0,
    name: 'First project'
  }, { scopeToken: scope.data.token });
  assert.equal(created.success, true);
  assert.equal(created.data.projectId, 'project-real');
  assert.equal(created.data.revision, 1);
  assert.equal(created.revision, 1);
  assert.equal(fixture.ui.bootstrapScope, null);
  assert.equal(fixture.calls.filter(call => call.name === 'create_project').length, 1);
});

test('schema-driven legacy fallback supports reads, scoped writes and registry model operations', async () => {
  const fixture = runtimeFixture();
  const context = loadHost(fixture);
  const mcp = context.BrevessWorkbenchMCP;
  const bootstrap = await mcp.requestBootstrapScope({ ttlMs: 60000 });
  await mcp.execute('create_project', {
    expectedProjectId: null,
    expectedRevision: 0,
    name: 'Host fallback project'
  }, { scopeToken: bootstrap.data.token });

  const unscopedRead = await mcp.legacyExecute('read_context', {});
  assert.equal(unscopedRead.success, true);
  assert.equal(unscopedRead.data.projectId, 'project-real');

  const unscopedWrite = await mcp.legacyExecute('edit_project', {
    expectedProjectId: 'project-real',
    expectedRevision: 1,
    operations: []
  });
  assert.equal(unscopedWrite.success, false);
  assert.equal(unscopedWrite.error.code, 'WORKBENCH_WRITE_SCOPE_REQUIRED');

  const normal = await mcp.requestWriteScope({
    projectId: 'project-real',
    operations: ['edit_project', 'create_hypothesis'],
    ttlMs: 60000
  });
  assert.equal(normal.success, true);
  assert.equal(normal.data.projectId, 'project-real');
  const edited = await mcp.legacyExecute('edit_project', {
    expectedProjectId: 'project-real',
    expectedRevision: 1,
    operations: []
  }, { scopeToken: normal.data.token });
  assert.equal(edited.success, true);
  assert.equal(edited.revision, 2);

  const hypothesis = await mcp.execute('create_hypothesis', {
    expectedProjectId: 'project-real',
    expectedRevision: 2,
    name: 'Branch and feedback hypothesis'
  }, { scopeToken: normal.data.token });
  assert.equal(hypothesis.success, true);
  assert.equal(hypothesis.data.createdId, 'hypothesis-real');
  assert.equal(hypothesis.revision, 3);

  const unknown = await mcp.execute('definitely_not_a_tool', {});
  assert.equal(unknown.success, false);
  assert.equal(unknown.error.code, 'WORKBENCH_OPERATION_UNKNOWN');
});

test('bootstrap cannot be replayed after a project exists and scope tokens are bound', async () => {
  const fixture = runtimeFixture();
  const context = loadHost(fixture);
  const mcp = context.BrevessWorkbenchMCP;
  const bootstrap = await mcp.requestBootstrapScope({ ttlMs: 60000 });
  await mcp.execute('create_project', {
    expectedProjectId: null,
    expectedRevision: 0,
    name: 'One project'
  }, { scopeToken: bootstrap.data.token });
  assert.throws(
    () => mcp.requestBootstrapScope({ ttlMs: 60000 }),
    /不能申请 bootstrap/
  );
  const normal = await mcp.requestWriteScope({
    projectId: 'project-real',
    operations: ['create_hypothesis'],
    ttlMs: 60000
  });
  const mismatch = await mcp.execute('create_hypothesis', {
    expectedProjectId: 'project-real',
    expectedRevision: 1,
    name: 'Should not run'
  }, { scopeToken: 'wrong-token' });
  assert.equal(mismatch.success, false);
  assert.equal(mismatch.error.code, 'WORKBENCH_WRITE_SCOPE_TOKEN_MISMATCH');
  assert.equal(normal.success, true);
});

test('host exposes library transfer export/import with human confirmation and reuses the Workbench commit hook', async () => {
  const fixture = runtimeFixture();
  const context = loadHost(fixture);
  const mcp = context.BrevessWorkbenchMCP;
  const exported = await mcp.execute('export_library_transfer', { scope: 'radar' });
  assert.equal(exported.success, true);
  assert.equal(exported.data.schema, 'brevess-library-transfer-v1');
  assert.equal(exported.data.kind, 'radar');
  const imported = await mcp.execute('import_library_transfer', { bundle: exported.data });
  assert.equal(imported.success, true);
  assert.equal(imported.data.summary.created, 1);
  assert.ok(fixture.calls.some(call => call.name === 'library-transfer-export'));
  assert.ok(fixture.calls.some(call => call.name === 'library-transfer-import'));
});
