(function (root, factory) {
  const shared = typeof module === 'object' && module.exports ? require('./research-workbench-model.js') : root.SciLLM;
  const api = factory(shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.SciLLM ||= {}, api);
})(globalThis, function (s) {
  'use strict';
  const STORES = ['projects', 'assets', 'outbox', 'recycle', 'views', 'conflicts', 'meta'];
  function removedEntityIds(value) {
    const ids=new Set();const collect=item=>{if(!item||typeof item!=='object')return;if(typeof item.id==='string')ids.add(item.id);for(const child of Object.values(item))if(child&&typeof child==='object')collect(child);};collect(value);return ids;
  }
  function clearNavigationSelection(value,removedIds) {
    if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(['projectId','hypothesisId','planId','figureId'].includes(key)&&removedIds.has(item))value[key]=null;else if(key==='selection'&&Array.isArray(item))value[key]=item.filter(id=>!removedIds.has(id));else if(item&&typeof item==='object')clearNavigationSelection(item,removedIds);}
  }
  function createMemoryResearchWorkbenchBackend() {
    const maps = Object.fromEntries(STORES.map(n => [n, new Map()])); let tail = Promise.resolve();
    return { transaction(names, fn) {
      const run = tail.then(() => {
        const staged = Object.fromEntries(names.map(n => [n, new Map([...maps[n]].map(([k,v]) => [k,s.wbClone(v)]))]));
        const value = fn(staged); if (value?.then) throw s.wbError('WORKBENCH_ASYNC_TRANSACTION');
        for (const n of names) maps[n] = staged[n]; return s.wbClone(value);
      }); tail = run.catch(() => {}); return run;
    } };
  }
  function createIndexedDbResearchWorkbenchBackend(indexedDB) {
    if (!indexedDB?.open) throw s.wbError('WORKBENCH_INDEXEDDB_UNAVAILABLE');
    let opening;
    function open() {
      return opening ||= new Promise((resolve,reject) => {
        const request = indexedDB.open(s.WORKBENCH_DATABASE_NAME, s.WORKBENCH_DATABASE_VERSION);
        request.onupgradeneeded = () => { for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
        request.onerror = () => { opening = null; reject(request.error); };
        request.onblocked = () => { opening = null; reject(s.wbError('WORKBENCH_DATABASE_BLOCKED')); };
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
      });
    }
    return { async get(name,key) {
      const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction([name],'readonly');const request=tx.objectStore(name).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    }, async transaction(names, fn, selections={}) {
      const db = await open();
      return new Promise((resolve,reject) => {
        const tx = db.transaction(names, 'readwrite'); const maps = {}; const original = {}; const touched = {}; let pending = names.reduce((sum,n)=>sum+(selections[n]?selections[n].length:2),0); let result; let thrown;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(thrown || tx.error || s.wbError('WORKBENCH_TRANSACTION_ABORTED'));
        tx.onerror = () => {};
        const loaded = () => {
          if (--pending) return;
          try {
            for (const n of names) { original[n] = new Map(maps[n].keys.map((k,i) => [k,maps[n].values[i]]).filter(([,v])=>v!==undefined)); maps[n] = new Map(original[n]); touched[n]=new Set(); maps[n].set=(key,value)=>{touched[n].add(key);Map.prototype.set.call(maps[n],key,value);return maps[n];}; }
            result = fn(maps); if (result?.then) throw s.wbError('WORKBENCH_ASYNC_TRANSACTION');
            for (const n of names) { const store = tx.objectStore(n); for (const k of original[n].keys()) if (!maps[n].has(k)) store.delete(k); for (const k of touched[n]) if(maps[n].has(k)) store.put(maps[n].get(k),k); }
          } catch(e) { thrown=e; tx.abort(); }
        };
        for (const n of names) {
          if(selections[n]){maps[n]={keys:selections[n],values:[]};selections[n].forEach((key,index)=>{const request=tx.objectStore(n).get(key);request.onsuccess=()=>{maps[n].values[index]=request.result;loaded();};});continue;}
          maps[n] = {}; const store = tx.objectStore(n); const keys=store.getAllKeys(); const values=store.getAll();
          keys.onsuccess=()=>{maps[n].keys=keys.result;loaded();}; values.onsuccess=()=>{maps[n].values=values.result;loaded();};
        }
      });
    } };
  }
  function createResearchWorkbenchStore({ indexedDB = globalThis.indexedDB, backend, locks = globalThis.navigator?.locks } = {}) {
    backend ||= createIndexedDbResearchWorkbenchBackend(indexedDB);
    const atomic = (names,fn,selections) => backend.transaction(names,fn,selections);
    const withProjectLock = (id,fn) => locks?.request ? locks.request(`brevess-workbench-project:${s.wbId(id)}`, {mode:'exclusive'}, fn) : fn();
    function expected(current, revision, proposed, maps) {
      if (!Number.isSafeInteger(revision) || revision < 0) throw s.wbError('WORKBENCH_EXPECTED_REVISION_REQUIRED');
      if ((current?.revision || 0) === revision) return null;
      const conflict = { id:s.wbNewId('conflict'), projectId:proposed.id, expectedRevision:revision, actualRevision:current?.revision || 0, proposed:s.wbClone(proposed), createdAt:Date.now() };
      maps.conflicts.set(conflict.id, conflict); return conflict;
    }
    function putRevision(maps, project, old, deleted = false) {
      project=s.wbValidateProject(project);
      if(old&&!deleted)for(const hypothesis of project.hypotheses){
        const previous=old.project.hypotheses.find(h=>h.id===hypothesis.id);if(!previous)continue;
        const semantic=h=>s.wbJson(s.wbScientificProjection({hypotheses:[h],plans:[],assets:[]}));
        const changed=semantic(previous)!==semantic(hypothesis);hypothesis.revision=(Number.isSafeInteger(previous.revision)?previous.revision:0)+Number(changed);
        if(changed)for(const plan of project.plans)for(const figure of plan.figures)for(const panel of figure.panels)for(const link of panel.links || [])if(link.hypothesisId===hypothesis.id&&link.revision!==hypothesis.revision)link.needsReview=true;
      }
      const revision=(old?.revision || 0)+1;
      const changedContent = !old || deleted !== old.deleted || s.wbJson(s.wbScientificProjection(project)) !== s.wbJson(s.wbScientificProjection(old.project));
      const changedLayout = !old || s.wbJson(s.wbLayoutProjection(project)) !== s.wbJson(s.wbLayoutProjection(old.project));
      const envelope={id:project.id,revision,contentRevision:(old?.contentRevision || 0)+Number(changedContent),layoutRevision:(old?.layoutRevision || 0)+Number(changedLayout),deleted,project:s.wbClone(project)};
      maps.projects.set(project.id,envelope);
      maps.outbox.set(`${project.id}:${revision}`,{id:`${project.id}:${revision}`,projectId:project.id,revision,deleted,snapshot:s.wbClone(envelope),state:'pending',attempts:0});
      maps.meta.set(`sync:${project.id}`,{localSaved:true,state:'pendingDir',revision,syncedRevision:maps.meta.get(`sync:${project.id}`)?.syncedRevision || 0});
      return envelope;
    }
    async function mutate(id, revision, update) {
      return withProjectLock(id, async () => {
        const result=await atomic(['projects','outbox','recycle','conflicts','meta','views'],maps=>{
          const old=maps.projects.get(id); if (!old) throw s.wbError('WORKBENCH_PROJECT_NOT_FOUND');
          const conflict=expected(old,revision,{id,operation:'mutation'},maps); if(conflict)return {conflict};
          const next=update(maps,s.wbClone(old)); return {value:next};
        });
        if(result.conflict)throw s.wbError('WORKBENCH_REVISION_CONFLICT',result.conflict); return result.value;
      });
    }
    const api = {
      backend, locks, withProjectLock,
      async getProject(id,{includeDeleted=false}={}) { return atomic(['projects'],m=>{const r=m.projects.get(s.wbId(id));return r && (includeDeleted || !r.deleted) ? s.wbClone(r) : null;}); },
      async listProjects() { return atomic(['projects'],m=>[...m.projects.values()].filter(r=>!r.deleted).map(s.wbClone)); },
      async saveProject(project,{expectedRevision,assets=[]}={}) {
        project=s.wbValidateProject(project); const prepared=[];
        for(const asset of assets) { s.wbId(asset.id);const bytes=await s.wbBytes(asset.bytes);const sha256=await s.wbSha256(bytes);if(asset.sha256 && asset.sha256!==sha256)throw s.wbError('WORKBENCH_ASSET_HASH_MISMATCH');if(!project.assets.some(a=>a.id===asset.id))throw s.wbError('WORKBENCH_ASSET_NOT_REFERENCED');prepared.push({id:asset.id,projectId:project.id,bytes,sha256,mimeType:asset.mimeType || 'application/octet-stream'}); }
        return withProjectLock(project.id,async()=>{
          const result=await atomic(['projects','assets','outbox','conflicts','meta'],m=>{
            const old=m.projects.get(project.id);const conflict=expected(old,expectedRevision,project,m);if(conflict)return {conflict};
            if(old?.deleted)throw s.wbError('WORKBENCH_PROJECT_DELETED');
            for(const a of prepared) {
              const key=`${project.id}/${a.id}`;const existing=m.assets.get(key);
              if(existing && existing.sha256!==a.sha256)throw s.wbError('WORKBENCH_ASSET_IMMUTABLE');
              m.assets.set(key,a);const meta=project.assets.find(x=>x.id===a.id);meta.sha256=a.sha256;meta.mimeType=a.mimeType;meta.byteLength=a.bytes.length;
            }
            return {value:putRevision(m,project,old)};
          },{assets:prepared.map(a=>`${project.id}/${a.id}`)});if(result.conflict)throw s.wbError('WORKBENCH_REVISION_CONFLICT',result.conflict);return result.value;
        });
      },
      async getAsset(projectId,id) { const key=`${s.wbId(projectId)}/${s.wbId(id)}`;return backend.get?s.wbClone(await backend.get('assets',key) || null):atomic(['assets'],m=>s.wbClone(m.assets.get(key) || null)); },
      async saveView(projectId,view,{expectedRevision}={}) {
        s.wbJson(view);return atomic(['projects','views','meta'],m=>{
          const p=m.projects.get(s.wbId(projectId));if(!p || p.deleted)throw s.wbError('WORKBENCH_PROJECT_NOT_FOUND');
          const old=m.views.get(projectId);if(!Number.isSafeInteger(expectedRevision) || (old?.revision || 0)!==expectedRevision)throw s.wbError('WORKBENCH_VIEW_CONFLICT');
          const row={projectId,revision:expectedRevision+1,view:s.wbClone(view)};m.views.set(projectId,row);m.meta.set('lastProject',projectId);return row;
        });
      },
      async getView(projectId) { return atomic(['views'],m=>s.wbClone(m.views.get(projectId) || null)); },
      async getLastProjectId() { return atomic(['meta'],m=>m.meta.get('lastProject') || null); },
      async getWorkbenchSelection() { return atomic(['meta'],m=>s.wbClone(m.meta.get('workbenchSelection') || {revision:0,selection:{projectId:null,mode:'overview',hypothesisId:null,planId:null,figureId:null}})); },
      async saveWorkbenchSelection(selection,{expectedRevision}={}) {
        s.wbJson(selection);return atomic(['projects','meta'],m=>{
          const old=m.meta.get('workbenchSelection');if(!Number.isSafeInteger(expectedRevision)||(old?.revision || 0)!==expectedRevision)throw s.wbError('WORKBENCH_SELECTION_CONFLICT');
          const p=selection.projectId?m.projects.get(s.wbId(selection.projectId)):null;if(selection.projectId&&(!p||p.deleted))throw s.wbError('WORKBENCH_PROJECT_NOT_FOUND');
          if(selection.hypothesisId&&!p?.project.hypotheses.some(h=>h.id===selection.hypothesisId))throw s.wbError('WORKBENCH_ENTITY_NOT_FOUND');
          const plan=selection.planId?p?.project.plans.find(plan=>plan.id===selection.planId):null;if(selection.planId&&!plan)throw s.wbError('WORKBENCH_ENTITY_NOT_FOUND');if(selection.figureId&&!plan?.figures.some(f=>f.id===selection.figureId))throw s.wbError('WORKBENCH_ENTITY_NOT_FOUND');
          const row={revision:expectedRevision+1,selection:s.wbClone(selection)};m.meta.set('workbenchSelection',row);m.meta.set('lastProject',selection.projectId || null);return row;
        });
      },
      async setLastProjectId(projectId,{expectedRevision}={}) { return api.saveWorkbenchSelection({projectId,mode:'overview',hypothesisId:null,planId:null,figureId:null},{expectedRevision}); },
      async getEntityView(projectId,{kind,id,planId}={}) {
        if(!['hypothesis','figure'].includes(kind))throw s.wbError('WORKBENCH_INVALID_VIEW_SCOPE');const key=`${s.wbId(projectId)}/${kind}/${kind==='figure'?s.wbId(planId)+'/':''}${s.wbId(id)}`;
        return atomic(['views'],m=>s.wbClone(m.views.get(key) || null));
      },
      async saveEntityView(projectId,{kind,id,planId},view,{expectedRevision}={}) {
        s.wbJson(view);if(!['hypothesis','figure'].includes(kind))throw s.wbError('WORKBENCH_INVALID_VIEW_SCOPE');const key=`${s.wbId(projectId)}/${kind}/${kind==='figure'?s.wbId(planId)+'/':''}${s.wbId(id)}`;
        return atomic(['projects','views'],m=>{
          const p=m.projects.get(projectId);if(!p||p.deleted)throw s.wbError('WORKBENCH_PROJECT_NOT_FOUND');const exists=kind==='hypothesis'?p.project.hypotheses.some(h=>h.id===id):p.project.plans.find(plan=>plan.id===planId)?.figures.some(f=>f.id===id);if(!exists)throw s.wbError('WORKBENCH_ENTITY_NOT_FOUND');
          const old=m.views.get(key);if(!Number.isSafeInteger(expectedRevision)||(old?.revision || 0)!==expectedRevision)throw s.wbError('WORKBENCH_VIEW_CONFLICT');const row={projectId,kind,id,planId:planId || null,revision:expectedRevision+1,view:s.wbClone(view)};m.views.set(key,row);return row;
        });
      },
      async listViews(projectId) { return atomic(['views'],m=>[...m.views.values()].filter(r=>r.projectId===projectId).map(s.wbClone)); },
      async listConflicts() { return atomic(['conflicts'],m=>[...m.conflicts.values()].map(s.wbClone)); },
      async deleteProject(id,{expectedRevision}={}) { return mutate(id,expectedRevision,(m,old)=>{
        if(old.deleted)throw s.wbError('WORKBENCH_PROJECT_DELETED');const recycle={id:s.wbNewId('recycle'),projectId:id,kind:'project',original:old.project,createdAt:Date.now()};m.recycle.set(recycle.id,recycle);
        if(m.meta.get('lastProject')===id)m.meta.set('lastProject',null);const selected=m.meta.get('workbenchSelection');if(selected?.selection.projectId===id)m.meta.set('workbenchSelection',{revision:selected.revision+1,selection:{...selected.selection,projectId:null,mode:'overview',hypothesisId:null,planId:null,figureId:null}});return {...putRevision(m,old.project,old,true),recycleId:recycle.id};
      }); },
      async deleteEntity(projectId,{kind,id,parentId,expectedRevision}={}) { return mutate(projectId,expectedRevision,(m,old)=>{
        if(old.deleted)throw s.wbError('WORKBENCH_PROJECT_DELETED');const previous=s.wbClone(old);const p=old.project;let list;
        if(kind==='plan')list=p.plans;else if(kind==='hypothesis')list=p.hypotheses;else if(kind==='figure')list=p.plans.find(x=>x.id===parentId)?.figures;else throw s.wbError('WORKBENCH_INVALID_RECYCLE_KIND');
        const index=list?.findIndex(x=>x.id===id) ?? -1;if(index<0)throw s.wbError('WORKBENCH_ENTITY_NOT_FOUND');
        const [original]=list.splice(index,1);const recycle={id:s.wbNewId('recycle'),projectId,kind,parentId:parentId || null,original,index,createdAt:Date.now()};
        const removedIds=removedEntityIds(original);
        // Remove navigation selections only; retain scientific references for explicit review.
        if(kind==='hypothesis'){recycle.associatedPlanIds=p.plans.filter(plan=>plan.hypothesisIds.includes(id)).map(plan=>plan.id);for(const plan of p.plans)plan.hypothesisIds=plan.hypothesisIds.filter(x=>x!==id);}
        const clear=value=>clearNavigationSelection(value,removedIds);
        clear(p.lastView);for(const h of p.hypotheses)clear(h.view);for(const plan of p.plans){clear(plan.view);for(const f of plan.figures)clear(f.view);}recycle.viewSnapshots=[];for(const [key,view]of m.views)if(view.projectId===projectId){const before=s.wbClone(view);clear(view.view);if(s.wbJson(before.view)!==s.wbJson(view.view)||removedIds.has(view.id)){view.revision++;recycle.viewSnapshots.push({key,row:before,after:s.wbClone(view)});m.views.set(key,view);}}const selection=m.meta.get('workbenchSelection');if(selection?.selection.projectId===projectId){const before=s.wbJson(selection.selection);clear(selection.selection);if(s.wbJson(selection.selection)!==before){selection.revision++;m.meta.set('workbenchSelection',selection);}}
        m.recycle.set(recycle.id,recycle);return {...putRevision(m,p,previous),recycleId:recycle.id};
      }); },
      async listRecycle(projectId) { return atomic(['recycle'],m=>[...m.recycle.values()].filter(r=>!projectId || r.projectId===projectId).map(s.wbClone)); },
      async restoreRecycle(recycleId,{expectedRevision}={}) {
        const item=await atomic(['recycle'],m=>s.wbClone(m.recycle.get(s.wbId(recycleId)) || null));if(!item)throw s.wbError('WORKBENCH_RECYCLE_NOT_FOUND');
        return mutate(item.projectId,expectedRevision,(m,old)=>{
          const current=m.recycle.get(recycleId);if(!current)throw s.wbError('WORKBENCH_RECYCLE_NOT_FOUND');const previous=s.wbClone(old);const p=old.project;
          if(item.kind==='project'){if(!old.deleted)throw s.wbError('WORKBENCH_RESTORE_CONFLICT');old.project=s.wbClone(item.original);}
          else {if(old.deleted)throw s.wbError('WORKBENCH_PROJECT_DELETED');const list=item.kind==='plan'?p.plans:item.kind==='hypothesis'?p.hypotheses:p.plans.find(x=>x.id===item.parentId)?.figures;if(!list)throw s.wbError('WORKBENCH_RESTORE_PARENT_MISSING');if(list.some(x=>x.id===item.original.id))throw s.wbError('WORKBENCH_RESTORE_CONFLICT');list.splice(Math.min(item.index,list.length),0,s.wbClone(item.original));if(item.kind==='hypothesis')for(const plan of p.plans)if(item.associatedPlanIds?.includes(plan.id)&&!plan.hypothesisIds.includes(item.original.id))plan.hypothesisIds.push(item.original.id);}
          const removedIds=removedEntityIds(item.original);
          for(const snapshot of item.viewSnapshots || []){
            const current=m.views.get(snapshot.key);let after=snapshot.after;
            // Legacy recycle rows omitted the deletion result; reconstruct it using
            // the same navigation clearing rule without changing stored old data.
            if(!after){after=s.wbClone(snapshot.row);after.revision++;clearNavigationSelection(after.view,removedIds);}
            if(current&&s.wbJson(current)!==s.wbJson(after))continue;
            m.views.set(snapshot.key,{...s.wbClone(snapshot.row),revision:(current?.revision || 0)+1});
          }m.recycle.delete(recycleId);return putRevision(m,old.project,previous,false);
        });
      },
      async listOutbox() { return atomic(['outbox'],m=>[...m.outbox.values()].sort((a,b)=>a.revision-b.revision).map(s.wbClone)); },
      async getSyncStatus(projectId) { return atomic(['meta'],m=>s.wbClone(m.meta.get(`sync:${projectId}`) || {localSaved:false,state:'localSaved',revision:0,syncedRevision:0})); },
      async settleOutbox(item,state,error=null) { return atomic(['projects','outbox','meta'],m=>{
        const queued=m.outbox.get(item.id);if(!queued)return;const p=m.projects.get(item.projectId);queued.state=state;queued.attempts++;queued.error=error;m.outbox.set(item.id,queued);
        if(p?.revision===item.revision && p.deleted===item.deleted)m.meta.set(`sync:${item.projectId}`,{localSaved:true,state:state==='synced'?'synced':state==='pending'?'pendingDir':state==='obsolete'?'pendingDir':'failed',revision:p.revision,syncedRevision:state==='synced'?p.revision:(m.meta.get(`sync:${item.projectId}`)?.syncedRevision || 0),error});
      }); },
      // All validation/hash work happens before one transaction: invalid imports cannot partially appear.
      async importProjects(entries,{selection}={}) {
        for(const entry of entries){s.wbValidateProject(entry.project);for(const a of entry.assets || [])if(await s.wbSha256(a.bytes)!==a.sha256)throw s.wbError('WORKBENCH_ASSET_HASH_MISMATCH');}
        return atomic(['projects','assets','outbox','meta','views'],m=>{
          for(const e of entries)if(m.projects.has(e.project.id))throw s.wbError('WORKBENCH_IMPORT_ID_COLLISION');
          const rows=entries.map(e=>{for(const a of e.assets || [])m.assets.set(`${e.project.id}/${a.id}`,{...s.wbClone(a),projectId:e.project.id});if(e.view)m.views.set(e.project.id,{projectId:e.project.id,revision:1,view:s.wbClone(e.view)});for(const v of e.entityViews || []){const key=`${e.project.id}/${v.kind}/${v.kind==='figure'?v.planId+'/':''}${v.id}`;m.views.set(key,{...s.wbClone(v),projectId:e.project.id,revision:1});}return putRevision(m,e.project,null);});if(selection){m.meta.set('workbenchSelection',{revision:(m.meta.get('workbenchSelection')?.revision || 0)+1,selection:s.wbClone(selection)});m.meta.set('lastProject',selection.projectId || null);}return rows;
        },{assets:entries.flatMap(e=>(e.assets || []).map(a=>`${e.project.id}/${a.id}`))});
      }
    };return api;
  }
  return { createMemoryResearchWorkbenchBackend, createIndexedDbResearchWorkbenchBackend, createResearchWorkbenchStore };
});
