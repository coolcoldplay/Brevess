const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source');
const source = fs.readFileSync(require.resolve('../extension/workbench/app.js'), 'utf8').replace(/^  (?=(?:async )?function )/gm, '');

function harness(extra = {}) {
  const calls = [], controls = new Map();
  const h = vm.createContext({
    E: v => String(v), calls,
    modal: (title, html, bind) => {
      calls.push({ title, html });
      bind?.({ querySelector: selector => {
        if (!controls.has(selector)) controls.set(selector, {});
        return controls.get(selector);
      }, close: () => calls.push('closed') });
    },
    run: fn => fn(),
    shareApi: () => ({ validateShare: async value => { calls.push('validate-share'); return value; } }),
    showShareImport: value => calls.push({ share: value }),
    previewLibraryTransfer: (file, kind) => calls.push({ transfer: kind }),
    importBundle: value => calls.push({ imported: value }),
    ...extra
  });
  vm.runInContext(['workbenchImportKind', 'previewWorkbenchImport', 'showWorkbenchExport'].map(n => functionSource(source, n)).join('\n'), h);
  return { h, calls, controls };
}
const file = value => ({ name: 'test.json', text: async () => JSON.stringify(value) });

test('one picker identifies every supported existing format without treating unknown JSON as a project', () => {
  const { h } = harness();
  for (const [value, kind] of [
    [{ kind: 'brevess-research-workbench-bundle' }, 'project'],
    [{ version: 1, projects: [] }, 'project'],
    [{ kind: 'brevess-research-share-v1' }, 'share'],
    [{ schema: 'brevess-library-transfer-v1', kind: 'radar' }, 'radar'],
    [{ schema: 'brevess-library-transfer-v1', kind: 'global-library' }, 'global'],
    [{ schemaVersion: 1, entries: [], groups: [] }, 'catalog'],
    [{ kind: 'unknown', version: 1, projects: [] }, ''],
    [{ projects: [] }, ''], [null, ''], [[], '']
  ]) assert.equal(h.workbenchImportKind(value), kind);
});

test('project import previews and cancellation write nothing; only confirmation imports', async () => {
  const { h, calls, controls } = harness();
  const value = { kind: 'brevess-research-workbench-bundle', projects: [{ project: { name: 'Preserved project' } }] };
  await h.previewWorkbenchImport(file(value));
  assert.equal(calls[0].title, '导入课题');
  assert.equal(calls.some(v => v.imported), false);
  controls.get('[data-import-cancel]').onclick();
  assert.equal(calls.some(v => v.imported), false);
  await h.previewWorkbenchImport(file(value));
  controls.get('[data-import-confirm]').onclick();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(v => v.imported).imported)), value);
});

test('share and library imports still pass through their existing validators and previews', async () => {
  const { h, calls } = harness();
  await h.previewWorkbenchImport(file({ kind: 'brevess-research-share-v1' }));
  assert.equal(calls[0], 'validate-share');
  assert.ok(calls[1].share);
  for (const kind of ['radar', 'global-library']) await h.previewWorkbenchImport(file({ schema: 'brevess-library-transfer-v1', kind }));
  assert.deepEqual(calls.filter(v => v.transfer).map(v => v.transfer), ['radar', 'global']);
  await assert.rejects(h.previewWorkbenchImport(file({ unrelated: true })), /暂不支持/);
  await assert.rejects(h.previewWorkbenchImport({ text: async () => '{bad' }), /无法读取/);
  assert.equal(calls.some(v => v.imported), false);
});

test('metadata restore captures the real catalog revision and preserves its explicit replacement step', async () => {
  const { h, calls, controls } = harness({
    catalogActions: {
      previewMetadataImport: () => ({ summary: { papers: 2, groups: 1, attachments: 0 } }),
      read: async () => ({ revision: 42 }),
      importMetadata: async request => calls.push({ request })
    }, loadGlobalLibrary: async () => {}, toast() {}
  });
  await h.previewWorkbenchImport(file({ schemaVersion: 1, entries: [], groups: [] }));
  assert.equal(calls[0].title, '恢复标签与资料');
  assert.match(calls[0].html, /替换现有/);
  assert.equal(calls.some(v => v.request), false);
  controls.get('[data-import-confirm]').onclick();
  await new Promise(r => setImmediate(r));
  assert.equal(calls.find(v => v.request).request.expectedRevision, 42);
  assert.equal(calls.find(v => v.request).request.mode, 'replace');
});
