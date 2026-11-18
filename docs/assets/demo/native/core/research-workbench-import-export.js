(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('./research-workbench-model.js'):root.SciLLM,common?require('./research-workbench-prototype-catalog.js'):root.SciLLM);if(common)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,function(s,catalog){
  'use strict';
  function base64(bytes) {let text='';for(const b of bytes)text+=String.fromCharCode(b);return btoa(text);}
  function decode64(value) {if(typeof value!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw s.wbError('WORKBENCH_INVALID_BASE64');return Uint8Array.from(atob(value),x=>x.charCodeAt(0));}
  async function imageBytes(value) {
    if(typeof value!=='string'||!value.startsWith('data:'))return null;
    const match=/^data:([^;,]+)(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(value);if(!match)throw s.wbError('WORKBENCH_INVALID_IMAGE');
    return {mimeType:match[1],bytes:match[2]?decode64(match[3]):new TextEncoder().encode(decodeURIComponent(match[3]))};
  }
  function activeEntityViews(rows,project) {
    if(rows===undefined)return [];if(!Array.isArray(rows))throw s.wbError('WORKBENCH_INVALID_VIEW_SCOPE');const scopes=new Set();
    return rows.filter(row=>{
      try {
        if(!row||row.projectId!==project.id||!['hypothesis','figure'].includes(row.kind)||!Number.isSafeInteger(row.revision)||row.revision<1||(row.view!==null&&(!row.view||Object.getPrototypeOf(row.view)!==Object.prototype)))throw s.wbError('WORKBENCH_INVALID_VIEW_SCOPE');
        s.wbId(row.id);if(row.kind==='figure')s.wbId(row.planId);else if(row.planId!==undefined&&row.planId!==null)throw s.wbError('WORKBENCH_INVALID_VIEW_SCOPE');
        if(row.view?.selection!==undefined&&row.view?.selection!==null){if(!Array.isArray(row.view.selection))throw s.wbError('WORKBENCH_INVALID_VIEW_SCOPE');for(const id of row.view.selection)s.wbId(id);}
      }catch{throw s.wbError('WORKBENCH_INVALID_VIEW_SCOPE');}
      const key=`${row.kind}/${row.planId || ''}/${row.id}`;if(scopes.has(key))throw s.wbError('WORKBENCH_INVALID_VIEW_SCOPE');scopes.add(key);
      return row.kind==='hypothesis'?project.hypotheses.some(h=>h.id===row.id):project.plans.find(plan=>plan.id===row.planId)?.figures.some(figure=>figure.id===row.id) || false;
    });
  }
  async function exportResearchWorkbenchBundle(store,{projectIds}={}) {
    const entries=[];
    for(const row of await store.listProjects()){
      if(projectIds&&!projectIds.includes(row.id))continue;const assets=[];
      for(const meta of row.project.assets){if(!meta.sha256)continue;const a=await store.getAsset(row.id,meta.id);if(!a||await s.wbSha256(a.bytes)!==meta.sha256)throw s.wbError('WORKBENCH_ASSET_UNAVAILABLE');assets.push({id:a.id,mimeType:a.mimeType,sha256:a.sha256,base64:base64(a.bytes)});}
      const current=await store.getProject(row.id);if(!current||current.revision!==row.revision)throw s.wbError('WORKBENCH_EXPORT_CHANGED');
      entries.push({project:s.wbClone(row.project),sourceRevision:row.revision,view:await store.getView(row.id),entityViews:activeEntityViews((await store.listViews(row.id)).filter(v=>v.kind),row.project),assets});
    }
    const bundle={kind:'brevess-research-workbench-bundle',schemaVersion:1,projects:entries,selection:(await store.getWorkbenchSelection()).selection};bundle.contentHash=await s.wbSha256(s.wbJson(bundle));return bundle;
  }
  async function importResearchWorkbenchBundle(store,input) {
    if(typeof input==='string'){try{input=JSON.parse(input);}catch{throw s.wbError('WORKBENCH_INVALID_IMPORT');}}
    s.wbJson(input);const formal=input.kind==='brevess-research-workbench-bundle';
    if(formal){if(input.schemaVersion!==1||!Array.isArray(input.projects))throw s.wbError('WORKBENCH_INVALID_IMPORT');const payload=s.wbClone(input);delete payload.contentHash;if(await s.wbSha256(s.wbJson(payload))!==input.contentHash)throw s.wbError('WORKBENCH_IMPORT_HASH_MISMATCH');}
    else if(input.version!==1||!Array.isArray(input.projects))throw s.wbError('WORKBENCH_INVALID_IMPORT');
    const incoming=formal?input.projects:input.projects.map(project=>({project,assets:[]}));
    const demo=catalog.getResearchWorkbenchPrototypeCatalog();const entries=[];const reports=[];let importedSelection;
    for(const incomingEntry of incoming){
      const p=s.wbValidateProject(incomingEntry.project);const originalId=p.id;const sourceEntityViews=activeEntityViews(incomingEntry.entityViews,p);const skippedEntityViews=(incomingEntry.entityViews?.length || 0)-sourceEntityViews.length;p.id=s.wbNewId('project');
      if(formal){const supplied=incomingEntry.assets;if(!Array.isArray(supplied)||new Set(supplied.map(a=>a.id)).size!==supplied.length)throw s.wbError('WORKBENCH_INVALID_IMPORT');for(const a of supplied){const meta=p.assets.find(m=>m.id===a.id);if(!meta)throw s.wbError('WORKBENCH_ASSET_NOT_REFERENCED');const sha=await s.wbSha256(decode64(a.base64));if(sha!==a.sha256||(meta.sha256&&meta.sha256!==sha)||(meta.mimeType&&meta.mimeType!==a.mimeType))throw s.wbError('WORKBENCH_ASSET_HASH_MISMATCH');}}
      const assetMap=new Map(p.assets.map(a=>[a.id,s.wbNewId('asset')]));const hypothesisMap=new Map(p.hypotheses.map(h=>[h.id,s.wbNewId('hypothesis')]));const edgeMaps=new Map(),nodeMaps=new Map();
      // Group-table row/column IDs and cells are local scientific content.
      // Their keys may legally resemble reference fields; preserve the whole
      // schema-validated subtree instead of interpreting cells as sources.
      const referenced=new Set();function findRefs(v){if(!v||typeof v!=='object'||v.workspaceId)return;for(const [key,value] of Object.entries(v)){if(key==='groupTable'||key==='materialLinks'||key==='evidenceBlocks')continue;if(key==='resourceId'&&typeof value==='string')referenced.add(value);if(key==='papers'&&Array.isArray(value))for(const r of value)if(typeof r==='string')referenced.add(r);if(value&&typeof value==='object')findRefs(value);}}findRefs(p);for(const link of p.materialLinks||[])if(link?.sourceKind==='library'&&typeof link.resourceId==='string')referenced.add(link.resourceId);
      const sourceRows=formal?(p.resources || []):demo;const resources=[];const resourceMap=new Map();
      for(const id of referenced){if(assetMap.has(id))continue;resourceMap.set(id,s.wbNewId('source'));const known=sourceRows.find(r=>r.id===id);resources.push(known?{...s.wbClone(known),id:resourceMap.get(id),originalId:id,...(!formal?{provenance:{kind:'demonstration',catalog:'prototype-seed-v1'},availability:'demonstration'}:{})}:{id:resourceMap.get(id),originalId:id,availability:'unavailable',provenance:{kind:'unknown'},title:null});}
      // Include all demo dependencies, not just top-level referenced resources.
      if(formal || referenced.size)for(const r of sourceRows)if(!resourceMap.has(r.id)){resourceMap.set(r.id,s.wbNewId('source'));resources.push({...s.wbClone(r),id:resourceMap.get(r.id),originalId:r.id,...(!formal?{provenance:{kind:'demonstration',catalog:'prototype-seed-v1'},availability:'demonstration'}:{})});}
      const remapSource=id=>assetMap.get(id)||resourceMap.get(id)||id;
      function refs(v){if(!v||typeof v!=='object'||v.workspaceId)return;for(const [key,value] of Object.entries(v)){if(key==='groupTable'||key==='materialLinks'||key==='evidenceBlocks')continue;if(['resourceId','ownAssetId'].includes(key)&&typeof value==='string')v[key]=remapSource(value);else if(['paperId','figureId','parentResourceId'].includes(key)&&typeof value==='string'&&resourceMap.has(value))v[key]=resourceMap.get(value);else if(['papers','panels'].includes(key)&&Array.isArray(value)&&value.every(x=>typeof x==='string'))v[key]=value.map(remapSource);else if(value&&typeof value==='object')refs(value);}}
      for(const h of p.hypotheses){const oldId=h.id;h.id=hypothesisMap.get(oldId);const nodeMap=new Map(h.nodes.map(n=>[n.id,s.wbNewId('node')]));nodeMaps.set(oldId,nodeMap);const edgeMap=new Map(h.edges.map(e=>[e.id,s.wbNewId('edge')]));edgeMaps.set(oldId,edgeMap);for(const n of h.nodes)n.id=nodeMap.get(n.id);for(const e of h.edges){e.id=edgeMap.get(e.id);e.source=nodeMap.get(e.source);e.target=nodeMap.get(e.target);for(const b of e.bindings || [])if(b.id)b.id=s.wbNewId('binding');}if(h.view?.selection)h.view.selection=h.view.selection.map(id=>nodeMap.get(id)||edgeMap.get(id)||id);}
      const planMap=new Map();const figureMaps=new Map(),planPanelMaps=new Map(),planPanelResourceMap=new Map(),evidenceBlockMap=new Map();
      for(const plan of p.plans){
        const oldPlan=plan.id;planMap.set(oldPlan,s.wbNewId('plan'));const figureMap=new Map(),panelMaps=new Map();figureMaps.set(oldPlan,figureMap);planPanelMaps.set(oldPlan,panelMaps);
        function remapPlan(value){
          value.id=planMap.get(oldPlan);if(value.hypothesisIds)value.hypothesisIds=value.hypothesisIds.map(id=>hypothesisMap.get(id)||id);
          for(const f of value.figures || []){const oldFigure=f.id;if(!figureMap.has(oldFigure))figureMap.set(oldFigure,s.wbNewId('figure'));const panelMap=panelMaps.get(oldFigure)||new Map();panelMaps.set(oldFigure,panelMap);f.id=figureMap.get(oldFigure);
            for(const panel of f.panels || []){const oldPanelId=panel.id;if(!panelMap.has(oldPanelId))panelMap.set(oldPanelId,s.wbNewId('panel'));const nextPanelId=panelMap.get(oldPanelId);if(!planPanelResourceMap.has(oldPanelId))planPanelResourceMap.set(oldPanelId,nextPanelId);panel.id=nextPanelId;for(const link of panel.links || []){const h=link.hypothesisId;link.hypothesisId=hypothesisMap.get(h)||h;link.edgeId=edgeMaps.get(h)?.get(link.edgeId)||link.edgeId;}}
            if(Array.isArray(f.evidenceBlocks))for(const block of f.evidenceBlocks){if(!evidenceBlockMap.has(block.id))evidenceBlockMap.set(block.id,s.wbNewId('evidence-block'));block.id=evidenceBlockMap.get(block.id);block.panelIds=(block.panelIds||[]).map(id=>panelMap.get(id)||id);}
            if(f.view?.selection)f.view.selection=f.view.selection.map(id=>panelMap.get(id)||id);
          }
          if(value.view){const oldFigure=value.view.figureId;value.view.figureId=figureMap.get(oldFigure)||null;if(value.view.selection)value.view.selection=value.view.selection.map(id=>panelMaps.get(oldFigure)?.get(id)||figureMap.get(id)||id);}
        }
        remapPlan(plan);for(const history of plan.history || [])if(history.snapshot)remapPlan(history.snapshot);
      }
      p.materialLinks=(p.materialLinks||[]).map(link=>{const next=s.wbClone(link),nodeMap=nodeMaps.get(link.hypothesisId),edgeMap=edgeMaps.get(link.hypothesisId);next.hypothesisId=hypothesisMap.get(next.hypothesisId)||next.hypothesisId;next.targetId=next.targetType==='node'?(nodeMap?.get(next.targetId)||next.targetId):(edgeMap?.get(next.targetId)||next.targetId);if(next.sourceKind==='library')next.resourceId=assetMap.get(next.resourceId)||resourceMap.get(next.resourceId)||next.resourceId;else if(next.sourceKind==='plan')next.resourceId=evidenceBlockMap.get(next.resourceId)||planPanelResourceMap.get(next.resourceId)||next.resourceId;return next;});
      if(p.lastView){const oldPlan=p.lastView.planId;p.lastView.planId=planMap.get(oldPlan)||null;p.lastView.hypothesisId=hypothesisMap.get(p.lastView.hypothesisId)||null;p.lastView.figureId=figureMaps.get(oldPlan)?.get(p.lastView.figureId)||null;}
      const binary=[];for(const a of p.assets){const old=a.id;a.id=assetMap.get(old);const supplied=incomingEntry.assets?.find(x=>x.id===old);let decoded;
        if(supplied){decoded={mimeType:supplied.mimeType,bytes:decode64(supplied.base64)};if(await s.wbSha256(decoded.bytes)!==supplied.sha256)throw s.wbError('WORKBENCH_ASSET_HASH_MISMATCH');}
        else if(!formal)decoded=await imageBytes(a.image);
        if(decoded){const sha256=await s.wbSha256(decoded.bytes);a.sha256=sha256;a.mimeType=decoded.mimeType;a.byteLength=decoded.bytes.length;binary.push({id:a.id,...decoded,sha256});}
        else if(a.sha256)throw s.wbError('WORKBENCH_ASSET_UNAVAILABLE');
        else if(a.image && !a.image.startsWith('data:')){a.availability='unavailable';a.originalImageUrl=a.image;delete a.image;}
      }
      let view=incomingEntry.view?.view? s.wbClone(incomingEntry.view.view) : (!formal && input.ui?.projectId===originalId ? s.wbClone(input.ui) : null);
      if(view){
        const active=formal?input.selection:input.ui;const fallback=active?.projectId===originalId?active:incomingEntry.project.lastView || {};
        const oldPlan=view.planId || fallback.planId,oldHypothesis=view.hypothesisId || fallback.hypothesisId,oldFigure=view.figureId || fallback.figureId || incomingEntry.project.plans.find(plan=>plan.id===oldPlan)?.view?.figureId;
        const mode=view.mode || (view.figureId || view.planId ? 'figure' : view.hypothesisId ? 'hypothesis' : fallback.mode);
        if(view.selection)view.selection=view.selection.map(id=>mode==='hypothesis'?(nodeMaps.get(oldHypothesis)?.get(id)||edgeMaps.get(oldHypothesis)?.get(id)||id):(planPanelMaps.get(oldPlan)?.get(oldFigure)?.get(id)||figureMaps.get(oldPlan)?.get(id)||id));
        view.projectId=p.id;view.planId=planMap.get(oldPlan)||null;view.hypothesisId=hypothesisMap.get(oldHypothesis)||null;if(Object.hasOwn(view,'figureId'))view.figureId=figureMaps.get(oldPlan)?.get(oldFigure)||null;
      }
      const entityViews=sourceEntityViews.map(v=>{const value=s.wbClone(v);if(v.kind==='hypothesis'){value.id=hypothesisMap.get(v.id);if(value.view?.selection)value.view.selection=value.view.selection.map(id=>nodeMaps.get(v.id)?.get(id)||edgeMaps.get(v.id)?.get(id)||id);}else if(v.kind==='figure'){value.id=figureMaps.get(v.planId)?.get(v.id);value.planId=planMap.get(v.planId);if(value.view?.selection)value.view.selection=value.view.selection.map(id=>planPanelMaps.get(v.planId)?.get(v.id)?.get(id)||id);}else throw s.wbError('WORKBENCH_INVALID_VIEW_SCOPE');if(!value.id)throw s.wbError('WORKBENCH_ENTITY_NOT_FOUND');return value;});
      const selection=formal?input.selection:input.ui;if(selection?.projectId===originalId){importedSelection=s.wbClone(selection);importedSelection.projectId=p.id;importedSelection.hypothesisId=hypothesisMap.get(selection.hypothesisId)||null;importedSelection.planId=planMap.get(selection.planId)||null;if(Object.hasOwn(selection,'figureId'))importedSelection.figureId=figureMaps.get(selection.planId)?.get(selection.figureId)||null;}
      refs(p);for(const r of resources)refs(r);p.resources=resources;entries.push({project:p,assets:binary,view,entityViews});reports.push({originalId,projectId:p.id,demonstration:!formal,unavailableSources:resources.filter(r=>r.availability==='unavailable').length,...(skippedEntityViews?{skippedEntityViews}:{})});
    }
    const saved=await store.importProjects(entries,{selection:importedSelection});return {projects:saved,report:reports};
  }
  return {exportResearchWorkbenchBundle,importResearchWorkbenchBundle};
});
