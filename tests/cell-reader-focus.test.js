const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const prefix = source.slice(0, source.indexOf('function effectiveArticlePageUrl('));
const scope = source.slice(source.indexOf('let sidePanelShortcutScope ='), source.indexOf('function isPageShortcutEditableTarget('));
function create(hostname = 'www.cell.com') {
  const dataset = {}; const context = vm.createContext({ document: { documentElement: { dataset } },
    location: { hostname, href: `https://${hostname}/cell/fulltext/S0092-8674(25)01247-4` },
    SciLLM: { selectPublisherAdapter: () => ({ family: 'elsevier' }) } });
  vm.runInContext(prefix + '\n' + scope, context);
  return { dataset, set: value => { context.input = value; return vm.runInContext('setSidePanelShortcutScope(input)', context); }, context };
}
for (const host of ['cell.com', 'www.cell.com']) {
  test(`UI-003 ${host} injection alone leaves publisher layout inactive`, () => {
    const { dataset } = create(host);
    assert.equal(dataset.sciReaderSingleColumn, undefined);
    assert.equal(dataset.sciPublisherFamily, undefined);
  });
  test(`UI-003 ${host} activation and exit symmetrically switch only layout attributes`, () => {
    const { dataset, set } = create(host); dataset.userAttribute = 'preserve';
    assert.equal(set({ enabled: true, shortcuts: { next: 'n' } }), true);
    assert.equal(dataset.sciReaderSingleColumn, 'true');
    assert.equal(dataset.sciPublisherFamily, 'elsevier');
    assert.equal(dataset.sciCellReaderActive, 'true');
    assert.equal(set({ enabled: false }), false);
    for (const key of ['sciReaderSingleColumn','sciPublisherFamily','sciCellReaderActive']) assert.equal(dataset[key], undefined);
    assert.equal(dataset.userAttribute, 'preserve');
    assert.ok(dataset.sciLlmContentRevision);
    set({enabled:true}); set({enabled:false});
    assert.equal(dataset.sciReaderSingleColumn, undefined);
  });
}
test('UI-003 only explicit enabled true activates Cell; shortcut filtering stays intact', () => {
  const { dataset, set, context } = create();
  for (const enabled of [undefined, null, 1, 'true', false]) { set({enabled}); assert.equal(dataset.sciReaderSingleColumn, undefined); }
  set({enabled:true,shortcuts:{next:' n ',bad:'long'}});
  assert.equal(vm.runInContext('sidePanelShortcutScope.shortcuts.next',context),'N');
  assert.equal(vm.runInContext('sidePanelShortcutScope.shortcuts.bad',context),undefined);
});
test('UI-003 preserves existing non-Cell publisher behavior', () => {
  for (const host of ['www.sciencedirect.com','cell.com.example.test','www.nature.com']) {
    const {dataset,set}=create(host);
    assert.equal(dataset.sciReaderSingleColumn,'true');
    assert.equal(dataset.sciPublisherFamily,'elsevier');
    set({enabled:false});
    assert.equal(dataset.sciReaderSingleColumn,'true');
    assert.equal(dataset.sciCellReaderActive,undefined);
  }
});
