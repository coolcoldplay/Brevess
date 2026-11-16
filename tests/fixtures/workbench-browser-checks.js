// Run in the isolated HTTP workbench after creating the QA project in the UI.
// Uses the actual browser IndexedDB store, never a Chrome extension context.
async function runWorkbenchBrowserChecks() {
  const rt = window.__workbenchRuntime, session = rt.session, store = session.store;
  const results = [];
  const check = (name, condition, details = {}) => {
    results.push({name, passed: !!condition, ...details});
    if (!condition) throw new Error('QA assertion failed: ' + name);
  };
  await session.drain();
  const original = structuredClone(rt.project());
  if (!original.name.startsWith('QA-20261113-')) throw new Error('QA project required');
  const bundle = await SciLLM.exportResearchWorkbenchBundle(store, {projectIds: [original.id]});
  const before = JSON.stringify(await store.listProjects());
  const bad = structuredClone(bundle);
  bad.projects[0].project.name = 'tampered';
  let failure;
  try { await SciLLM.importResearchWorkbenchBundle(store, bad); } catch (e) { failure = e.code; }
  check('Tampered export rejected without changing projects',
    failure === 'WORKBENCH_IMPORT_HASH_MISMATCH' && JSON.stringify(await store.listProjects()) === before,
    {errorCode: failure});
  const corruptAsset = structuredClone(bundle);
  corruptAsset.projects[0].assets[0].base64 = btoa('corrupted bytes');
  delete corruptAsset.contentHash;
  corruptAsset.contentHash = await SciLLM.wbSha256(SciLLM.wbJson(corruptAsset));
  failure = null;
  try { await SciLLM.importResearchWorkbenchBundle(store, corruptAsset); } catch (e) { failure = e.code; }
  check('Corrupt image rejected atomically',
    failure === 'WORKBENCH_ASSET_HASH_MISMATCH' && JSON.stringify(await store.listProjects()) === before,
    {errorCode: failure});
  const stale = await store.getProject(original.id);
  const current = structuredClone(stale.project);
  current.question += ' [QA concurrent writer]';
  await store.saveProject(current, {expectedRevision: stale.revision});
  failure = null;
  try { await session.edit('QA stale save', p => { p.name += ' unsaved'; }); } catch (e) { failure = e.code; }
  const persisted = await store.getProject(original.id);
  check('Concurrent save keeps newer data and retains unsaved proposal',
    failure === 'WORKBENCH_REVISION_CONFLICT' && persisted.project.question === current.question &&
    persisted.project.name === original.name && session.state.proposal.name.endsWith(' unsaved'),
    {errorCode: failure});
  await session.reload();
  check('Reload resolves conflict and clears proposal', !session.state.proposal && session.state.row.revision === persisted.revision);
  await session.edit('Restore QA research question', p => { p.question = original.question; });
  for (const kind of ['hypothesis', 'figure', 'plan']) {
    const p = session.state.row.project;
    const owner = kind === 'hypothesis' ? p.hypotheses[0] : kind === 'plan' ? p.plans[0] : p.plans[0].figures[0];
    const prior = JSON.stringify(owner);
    const deleted = await session.remove(kind, owner.id, kind === 'figure' ? p.plans[0].id : undefined);
    const remaining = session.state.row.project;
    check(kind + ' deleted to recycle bin',
      (await store.listRecycle(p.id)).some(r => r.id === deleted.recycleId) &&
      !(kind === 'hypothesis' ? remaining.hypotheses : kind === 'plan' ? remaining.plans : remaining.plans[0].figures).some(r => r.id === owner.id));
    await session.restore(deleted.recycleId);
    const restored = session.state.row.project;
    const item = (kind === 'hypothesis' ? restored.hypotheses : kind === 'plan' ? restored.plans : restored.plans[0].figures).find(r => r.id === owner.id);
    check(kind + ' restored without content loss', JSON.stringify(item) === prior);
  }
  const a = session.state.row.project.assets[0];
  const bytes = await store.getAsset(original.id, a.id);
  check('Image bytes survive import and recycle operations', await SciLLM.wbSha256(bytes.bytes) === a.sha256);
  const library = await rt.globalLibraryReader.query({page: 1, pageSize: 40, query: '', includeRemoved: false, includeRadarRead: true});
  check('Library duplicate import remains one entry', library.items.length === 1);
  check('Manual metadata survives transfer merge', library.items[0].title === 'QA Macrophage signaling — edited');
  check('No unhandled page errors', window.__qaErrors.length === 0, {errors: window.__qaErrors});
  rt.render();
  return {environment: 'isolated HTTP UI with actual IndexedDB; mocked extension transport', results};
}
