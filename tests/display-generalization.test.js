const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../web-filters-general/schema.js');
const M = require('../web-filters-general/reading-modules.js');
const G = require('../web-filters-general/generalization.js');
globalThis.WFGModel = require('../web-filters-general/model.js');

const copy = value => structuredClone(value);
const response = () => ({ name: '论文段落样式', selectors: ['.paper-body > p'], hosts: ['papers.example'],
  pathPrefixes: ['/articles/'], excludePrefixes: ['/articles/search/'], roots: ['.paper-body'], required: ['h1.paper-title'],
  common: '共同的正文容器和段落结构。', differences: '正文容器编号不同，正文段落数不同。', scopeReason: '仅论文路径且必须匹配论文标题和正文容器。' });
function sample(id) {
  const url = `https://papers.example/articles/${id}`;
  const plan = { schemaVersion: 2, id: `plan-${id}`, revision: 0, name: '段落',
    scope: { mode: 'route', origin: 'https://papers.example', path: `/articles/${id}`, exactHash: '' },
    operations: [{ type: 'style', target: { frame: 'top', roots: [], selector: `#body-${id} > p` }, styles: { 'font-size': '22px', 'line-height': '1.8' } }] };
  return { tabId: id, windowId: 7, title: `Paper ${id}`, url, session: `session-${id}`, plan,
    groups: [{ target: plan.operations[0].target, ids: [`p-${id}`], items: [{ id: `p-${id}`, tag: 'p', text: `Sample ${id}`,
      attributes: {}, target: plan.operations[0].target, structure: { ancestors: [{ tag: 'article', attributes: { id: `body-${id}`, class: 'paper-body' } }] } }] }] };
}
function state(s) { return { ...s, targets: [{ id: s.groups[0].ids[0], frameId: 0 }], preview: true, feedback: [{ verified: true }] }; }
function harness() {
  const pages = new Map([1, 2, 3].map(id => [id, sample(id)]));
  const storage = {};
  let raw, modelReply = response(), modelInput, readingError = false, extraNode = false, mismatch = false, activateCount = 0, modelCalls = 0, notifyCount = 0;
  const repo = M.repository({ readRaw: async () => raw, writeRaw: async value => { raw = value; } });
  const repository = { ...repo, activate: async (...args) => { activateCount++; return repo.activate(...args); } };
  const b = { storage: { session: { get: async key => ({ [key]: copy(storage[key]) }), set: async patch => Object.assign(storage, copy(patch)) } },
    tabs: { get: async id => { const s = pages.get(id); if (!s) throw Error('Closed'); return { id, windowId: s.windowId, url: s.url }; } } };
  const broker = {
    overview: async id => ({ frames: [{ frameId: 0, ok: true, data: { session: pages.get(id).session } }] }),
    rpc: async (id, frame, command, data) => {
      const s = pages.get(id);
      if (command === 'GENERALIZATION_STATUS') return { session: s.session, plan: copy(s.plan), verified: true };
      if (command === 'READING_VALIDATE_PLAN') { if (readingError) throw Error('READING_ROOT_REQUIRED'); return {rules:{roots:['.paper-body'],required:['h1.paper-title']}}; }
      if (command === 'READING_VALIDATE_MODULE') { if (mismatch) throw Error('SAVED_STRUCTURE_UNMATCHED'); return { verified: true }; }
      if (data.tool === 'verifyRecords') return { verified: true };
      if (data.tool === 'planTargets') return { groups: data.args.targets.map(target => ({ ...copy(s.groups[0]), target,
        ids: extraNode && target.selector === '.paper-body > p' ? [...s.groups[0].ids, 'unapproved-sidebar'] : [...s.groups[0].ids] })) };
      throw Error(command);
    }
  };
  const createTask = async () => ({ maxCharacters: 24000, adapter: { async *generateTextStream(input) {
    modelCalls++; modelInput = input; assert.match(input.systemPrompt, /untrusted data/); assert.equal(JSON.parse(input.userPrompt).samples.length, 2);
    yield { type: 'text_delta', text: JSON.stringify(typeof modelReply==='function'?modelReply(modelCalls):modelReply) }; yield { type: 'completed', finishReason: 'stop' };
  } } });
  const options = { browser: b, broker, createTask, repository: () => repository, notify: async () => { notifyCount++; } };
  const controller = G.create(options);
  return { controller, options, pages, repo, storage, setReply: v => { modelReply = v; }, overmatch: () => { extraNode = true; }, structureMismatch: () => { mismatch = true; },
    counts: () => ({ activateCount, modelCalls, notifyCount }), raw: () => raw,
    input: () => modelInput, readingUnavailable: () => { readingError = true; } };
}
async function two(h) { await h.controller.ready; await h.controller.add(state(h.pages.get(1))); await h.controller.add(state(h.pages.get(2))); }

test('one page, duplicate tabs and query-only changes cannot count as two independent samples', async () => {
  const h = harness(); await h.controller.ready; await h.controller.add(state(h.pages.get(1)));
  await assert.rejects(h.controller.generate(7), /GENERALIZE_TWO_PAGES_REQUIRED/);
  const duplicate = copy(h.pages.get(1)); duplicate.tabId = 2; duplicate.url += '?tracking=1'; h.pages.set(2, duplicate);
  await h.controller.add(state(duplicate)); assert.equal(h.controller.summary(7).samples.length, 1);
  await assert.rejects(h.controller.generate(7), /GENERALIZE_TWO_PAGES_REQUIRED/); assert.equal(h.counts().modelCalls, 0);
});

test('selected, verified previews are required on both pages', async () => {
  const h = harness(); await h.controller.ready;
  await assert.rejects(h.controller.add({ ...state(h.pages.get(1)), targets: [] }), /GENERALIZE_SELECT_REQUIRED/);
  await assert.rejects(h.controller.add({ ...state(h.pages.get(1)), targets: [{ id: 'other', frameId: 0 }] }), /GENERALIZE_SELECT_REQUIRED/);
  await assert.rejects(h.controller.add({ ...state(h.pages.get(1)), preview: false }), /PREVIEW_NOT_VERIFIED/);
  await assert.rejects(h.controller.add({ ...state(h.pages.get(1)), feedback: [{ verified: false }] }), /PREVIEW_NOT_VERIFIED/);
});

test('confirmed nearby container previews require a live DOM relationship proof', async () => {
  const h = harness(); await h.controller.ready;
  const st = state(h.pages.get(1)); st.targets = [{ id: 'nested-selected', frameId: 0 }];
  await assert.rejects(h.controller.add(st), /GENERALIZE_SELECT_REQUIRED/);
  h.pages.get(1).groups[0].selectionRelated = true;
  await h.controller.add(st);
  assert.equal(h.controller.summary(7).samples.length, 1);
  h.pages.get(1).groups[0].selectionRelated = false;
  await assert.rejects(h.controller.add(st), /GENERALIZE_SELECT_REQUIRED/);
});

test('samples must describe the same effects, not merely matching selectors', async () => {
  const h = harness(); await h.controller.ready; await h.controller.add(state(h.pages.get(1)));
  h.pages.get(2).plan.operations[0].styles['font-size'] = '10px';
  await assert.rejects(h.controller.add(state(h.pages.get(2))), /GENERALIZE_EFFECT_MISMATCH/);
});

test('AI selector inference preserves effects and restricts host, path and DOM structure', () => {
  const module = G.candidate(response(), [sample(1), sample(2)]);
  assert.deepEqual(module.rules.operations[0].styles, sample(1).plan.operations[0].styles);
  assert.equal(M.matches(module, 'https://papers.example/articles/3'), true);
  assert.equal(M.matches(module, 'https://papers.example/help/3'), false);
  assert.equal(M.matches(module, 'https://papers.example/articles/search/3'), false);
  assert.equal(M.matches(module, 'https://other.example/articles/3'), false);
});

test('model cannot return arbitrary code, unknown hosts, or sample ID enumeration', () => {
  const examples = [sample(1), sample(2)];
  for (const patch of [{ hosts: ['*.example'] }, { pathPrefixes: ['/'] , hosts: ['unknown.example'] }, { roots: [] },
    { required: [] }, { selectors: ['#body-1 > p, #body-2 > p'] }, { selectors: ['.paper-body > p:nth-child(1)'] },
    { selectors: ['body'], operations: [{ type: 'hide' }] }]) assert.throws(() => G.candidate({ ...response(), ...patch }, examples));
});

test('extra, missing or reordered target groups fail exact approved-region validation', () => {
  assert.throws(() => G.assertGroups([{ ids: ['p'] }], [{ ids: ['p', 'sidebar'] }]), /GENERALIZE_TARGET_MISMATCH/);
  assert.throws(() => G.assertGroups([{ ids: ['p', 'q'] }], [{ ids: ['p'] }]), /GENERALIZE_TARGET_MISMATCH/);
  assert.doesNotThrow(() => G.assertGroups([{ ids: ['q', 'p'] }], [{ ids: ['p', 'q'] }]));
});

test('two samples generate a candidate but nothing is enabled until confirmation', async () => {
  const h = harness(); await two(h); await h.controller.generate(7);
  const draft = h.controller.summary(7); assert.equal(draft.candidate.checks.length, 2);
  assert.equal(h.counts().activateCount, 0); assert.equal(draft.saved, false);
  await assert.rejects(h.controller.save(7, 'forged-token'), /SAVE_CONFIRMATION_EXPIRED/);
  await h.controller.save(7, draft.candidate.token);
  assert.deepEqual(h.counts(), { modelCalls: 1, activateCount: 1, notifyCount: 1 });
  assert.equal(h.controller.summary(7).saved, true);
  assert.equal(h.raw().entries.filter(e => e.enabled && !e.builtinId).length, 1);
});

test('candidate that overmatches a sidebar is never offered for saving', async () => {
  const h = harness(); await two(h); h.overmatch();
  await assert.rejects(h.controller.generate(7), /GENERALIZE_TARGET_MISMATCH/);
  assert.equal(h.controller.summary(7).candidate, null); assert.equal(h.counts().activateCount, 0);
});

test('each page must satisfy candidate reading structure and protection checks', async () => {
  const h = harness(); await two(h); h.structureMismatch();
  await assert.rejects(h.controller.generate(7), /SAVED_STRUCTURE_UNMATCHED/); assert.equal(h.counts().activateCount, 0);
});

test('navigation between generation and confirmation invalidates the candidate', async () => {
  const h = harness(); await two(h); await h.controller.generate(7);
  const token = h.controller.summary(7).candidate.token; h.pages.get(2).url = 'https://papers.example/articles/changed';
  await assert.rejects(h.controller.save(7, token), /GENERALIZE_SAMPLE_CHANGED/);
  assert.equal(h.counts().activateCount, 0); assert.equal(h.controller.summary(7).candidate, null);
});

test('closing or reloading a sample immediately marks it stale', async () => {
  const h = harness(); await two(h); await h.controller.generate(7); await h.controller.invalidate(2);
  assert.equal(h.controller.summary(7).samples[1].stale, true); assert.equal(h.controller.summary(7).candidate, null);
  await assert.rejects(h.controller.generate(7), /GENERALIZE_SAMPLE_CHANGED/);
});

test('preview edits after approval cannot silently reuse old evidence', async () => {
  const h = harness(); await two(h); h.pages.get(2).plan.operations[0].styles.color = 'red';
  await assert.rejects(h.controller.generate(7), /GENERALIZE_SAMPLE_CHANGED/); assert.equal(h.counts().modelCalls, 0);
});

test('service worker restart restores the sample set from session storage', async () => {
  const h = harness(); await two(h); const restarted = G.create(h.options); await restarted.ready;
  assert.equal(restarted.summary(7).samples.length, 2); await restarted.generate(7); assert.ok(restarted.summary(7).candidate);
});

test('removing a sample invalidates inference; cancelling keeps saved preferences unchanged', async () => {
  const h = harness(); await two(h); await h.controller.generate(7); await h.controller.remove(7, 2);
  assert.equal(h.controller.summary(7).candidate, null); assert.equal(h.controller.summary(7).samples.length, 1);
  await h.controller.cancel(7); assert.equal(h.controller.summary(7), null); assert.equal(h.counts().activateCount, 0);
});

test('repository generation conflicts prevent overwriting concurrent preference edits', async () => {
  const h = harness(); await two(h); await h.controller.generate(7); const token = h.controller.summary(7).candidate.token;
  const store = await h.repo.read(); await h.repo.setEnabled(store.entries[0].module.id, false, store.generation);
  await assert.rejects(h.controller.save(7, token), /GENERATION_CONFLICT/);
  assert.equal(h.raw().entries.filter(e => !e.builtinId).length, 0);
});

test('local exact-path modules cannot match sibling paths or URL prefix collisions', () => {
  const module = G.candidate(response(), [sample(1), sample(2)]);
  module.match.pathMode = 'exact'; module.match.pathPrefixes = ['/articles/1'];
  assert.equal(M.matches(module, 'https://papers.example/articles/1?q=x'), true);
  for (const path of ['/articles/2', '/articles/1-other', '/articles/1/child']) assert.equal(M.matches(module, 'https://papers.example' + path), false);
  assert.match(G.scopeLabel(module), /相同路径 \/articles\/1/);
});

test('save endpoint rejects manually broadening a single-page rule before any module validation', async () => {
  const tab = { id: 1, windowId: 7, url: 'https://papers.example/articles/1' }, handlers = [];
  const browser = { runtime: { id: 'extension', getContexts: async () => [{ documentUrl: 'chrome-extension://extension/popup.html', windowId: 7 }], onMessage: { addListener: f => handlers.push(f) }, sendMessage: async () => {} },
    storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
    webNavigation: { getAllFrames: async () => [{ frameId: 0, documentId: 'doc-1' }] },
    tabs: { get: async () => tab, query: async () => [tab], onRemoved: { addListener() {} }, onActivated: { addListener() {} }, onUpdated: { addListener() {} } } };
  const context = { WFGSchema: S, WFGReadingModules: M, WFGGeneralization: G, crypto, URL, console };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web-filters-general/ux-background.js'), 'utf8'), context);
  const broker = { overview: async () => ({ frames: [{ frameId: 0, ok: true, data: { session: 'session-1', version: 0 } }] }), rpc: async () => ({}) };
  const controller = context.WFGUX.install({ browser, broker, multi: {} });
  const sender = { id: 'extension', url: 'chrome-extension://extension/popup.html' };
  await controller.handle({ command: 'STATE' }, sender);
  Object.assign(controller.states.get(1), { plan: sample(1).plan, preview: true, feedback: [{ verified: true }] });
  await assert.rejects(controller.handle({ command: 'PREPARE_SAVE', scopeUrl: 'https://papers.example/articles/' }, sender), /GENERALIZE_TWO_PAGES_REQUIRED/);
});

test('copying a verified single sample preserves effects but never copies its selectors', async()=>{
 const h=harness();await h.controller.ready;const st=state(h.pages.get(1));st.lastDisplayRequest='正文22px，行距1.8';await h.controller.add(st);
 const effect=await h.controller.effect(7);assert.deepEqual(effect.operation.styles,st.plan.operations[0].styles);assert.equal(effect.operation.target,undefined);
 assert.equal(h.controller.summary(7).canTransfer,true);assert.equal(h.controller.summary(7).request,st.lastDisplayRequest);
 await h.controller.invalidate(1);await assert.rejects(h.controller.effect(7),/GENERALIZE_SAMPLE_CHANGED/);
});

test('automatic image display accepts uncropped sizing and refuses crop or forced height',()=>{
 const module=G.candidate(response(),[sample(1),sample(2)]);
 module.rules.operations=[{type:'style',target:{frame:'top',roots:[],selector:'figure img'},styles:{width:'100%','max-width':'100%',height:'auto','max-height':'none','object-fit':'contain'}}];
 assert.doesNotThrow(()=>M.validate(module));
 for(const patch of [{height:'400px'},{'object-fit':'cover'},{'max-height':'200px'}]){const bad=copy(module);Object.assign(bad.rules.operations[0].styles,patch);assert.throws(()=>M.validate(bad),/MODULE_MEDIA_CROPPING_DENIED/);}
});

test('PLOS article identity uses DOI query; tracking and anchors remain the same sample', () => {
  const a='https://journals.plos.org/plospathogens/article?id=10.1371/journal.ppat.1013810';
  const b='https://journals.plos.org/plospathogens/article?id=10.1371/journal.ppat.1000001';
  assert.notEqual(M.pageKey(a),M.pageKey(b));
  assert.equal(M.pageKey(a),M.pageKey(a+'&utm_source=qa#figure'));
  const module=G.candidate(response(),[sample(1),sample(2)]);
  module.match={hosts:['journals.plos.org'],excludeHosts:[],pathPrefixes:['/plospathogens/article'],excludePrefixes:[],pathMode:'exact',queryEquals:M.pageQuery(a)};
  M.validate(module);assert.equal(M.matches(module,a),true);assert.equal(M.matches(module,a+'&utm_source=qa'),true);
  assert.equal(M.matches(module,b),false);assert.equal(M.matches(module,a+'&id=10.1371/journal.ppat.1000001'),false);
  assert.match(G.scopeLabel(module),/文献 id=10.1371/);
  assert.notEqual(M.matchKey(module.match),M.matchKey({...module.match,queryEquals:M.pageQuery(b)}));
  const imported=M.imported(M.exported(module));assert.deepEqual(imported.match.queryEquals,module.match.queryEquals);
});

test('shared IDs in verified hidden-target selectors remain usable after attribute redaction', () => {
 const examples=[sample(1),sample(2)];
 for(const s of examples){s.plan.operations[0].target.selector='#sticky-nav';s.groups[0].target.selector='#sticky-nav';s.groups[0].items[0].attributes={};}
 assert.doesNotThrow(()=>G.candidate({...response(),selectors:['#sticky-nav']},examples));
 examples[1].groups[0].target.selector='#other-nav';
 assert.throws(()=>G.candidate({...response(),selectors:['#sticky-nav']},examples),/GENERALIZE_SELECTOR_OVERFIT/);
});

test('unrelated page changes do not invalidate captured preview evidence; changed targets still fail',async()=>{
 const h=harness();await h.controller.ready;const p=h.pages.get(1),st=state(p);
 st.sampleEvidence={session:p.session,groups:copy(p.groups)};
 await h.controller.add(st);
 st.sampleEvidence.session='stale';await assert.rejects(h.controller.add(st),/GENERALIZE_SAMPLE_CHANGED/);
 st.sampleEvidence.session=p.session;st.sampleEvidence.groups[0].ids.push('changed-node');
 await assert.rejects(h.controller.add(st),/GENERALIZE_TARGET_MISMATCH/);
});

test('inference receives verified reading roots and refuses samples without a replayable article root', async()=>{
 const h=harness();await two(h);await h.controller.generate(7);
 const input=JSON.parse(h.input().userPrompt);
 for(const s of input.samples) assert.deepEqual(s.readingStructure,{roots:['.paper-body'],required:['h1.paper-title']});
 const unavailable=harness();await unavailable.controller.ready;unavailable.readingUnavailable();
 await assert.rejects(unavailable.controller.add(state(unavailable.pages.get(1))),/READING_ROOT_REQUIRED/);
 assert.equal(unavailable.controller.summary(7),null);assert.equal(unavailable.counts().modelCalls,0);
});


test('multiple formatting operations on one selected region transfer together without source selectors',async()=>{
 const h=harness();await h.controller.ready;const page=h.pages.get(1);
 page.plan.operations.push({type:'style',target:copy(page.plan.operations[0].target),styles:{color:'#333333'}});
 await h.controller.add(state(page));assert.equal(h.controller.summary(7).canTransfer,true);
 const effect=await h.controller.effect(7);assert.equal(effect.operations.length,2);assert.ok(effect.operations.every(op=>!op.target));assert.equal(effect.operations[1].styles.color,'#333333');
});
test('different-region operations never transfer blindly onto a single new selection',async()=>{
 const h=harness();await h.controller.ready;const page=h.pages.get(1);
 page.plan.operations.push({type:'hide',target:{frame:'top',roots:[],selector:'.aside'}});
 await h.controller.add(state(page));assert.equal(h.controller.summary(7).canTransfer,false);await assert.rejects(h.controller.effect(7),/GENERALIZE_OPERATION_UNSUPPORTED/);
});


test('one rejected candidate is corrected with validation evidence, never saved without confirmation',async()=>{
 const h=harness();await two(h);h.setReply(attempt=>attempt===1?{...response(),selectors:['#single-page-unique']}:response());
 await h.controller.generate(7);assert.equal(h.counts().modelCalls,2);assert.ok(h.controller.summary(7).candidate);assert.equal(h.counts().activateCount,0);
 assert.match(JSON.parse(h.input().userPrompt).correction,/GENERALIZE_SELECTOR_OVERFIT/);
});
