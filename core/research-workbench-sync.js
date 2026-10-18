(function (root, factory) {
  const s = typeof module === 'object' && module.exports ? require('./research-workbench-model.js') : root.SciLLM;
  const api=factory(s);if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);
})(globalThis,function(s){
  'use strict';
  const ROOT='research-workbench';
  function restrictedPath(path) {
    if(typeof path!=='string'||!path.startsWith(`${ROOT}/`)||path.length>700||path.split('/').some(p=>!p||p==='.'||p==='..'||!/^[A-Za-z0-9_.-]+$/.test(p)))throw s.wbError('WORKBENCH_INVALID_PATH');
    return path;
  }
  function createResearchWorkbenchDirectoryAdapter({getHandle}={}) {
    async function file(path,create=false) {
      restrictedPath(path);const handle=await getHandle?.();
      if(!handle||await handle.queryPermission({mode:'readwrite'})!=='granted')throw s.wbError('WORKBENCH_DIRECTORY_PERMISSION');
      // Match DirectorySync's active root without stranding the legacy binding/index.
      let directory;
      for(const name of ['Brevess','SCI-Highlighter']) {
        try {directory=await handle.getDirectoryHandle(name,{create:false});break;}
        catch(error){if(error.name!=='NotFoundError')throw error;}
      }
      directory ||= await handle.getDirectoryHandle('Brevess',{create});const parts=path.split('/');const name=parts.pop();
      for(const part of parts)directory=await directory.getDirectoryHandle(part,{create});return directory.getFileHandle(name,{create});
    }
    return {
      async read(path) {try {const handle=await file(path);return new Uint8Array(await (await handle.getFile()).arrayBuffer());}catch(e){if(e.name==='NotFoundError')return null;throw e;}},
      async write(path,bytes) {const handle=await file(path,true);const writable=await handle.createWritable();try{await writable.write(await s.wbBytes(bytes));await writable.close();}catch(e){try{await writable.abort();}catch{}throw e;}}
    };
  }
  async function readJson(adapter,path) {const bytes=await adapter.read(restrictedPath(path));if(bytes===null)return null;try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw s.wbError('WORKBENCH_DIRECTORY_INVALID_JSON',{path});}}
  async function writeVerified(adapter,path,value) {
    const bytes=await s.wbBytes(value);await adapter.write(restrictedPath(path),bytes);const read=await adapter.read(path);
    if(read===null||await s.wbSha256(read)!==await s.wbSha256(bytes))throw s.wbError('WORKBENCH_DIRECTORY_READBACK_MISMATCH',{path});
  }
  function manifestValid(m,projectId) {
    if(!m||m.kind!=='brevess-research-workbench-project'||m.schemaVersion!==1||m.projectId!==projectId||!Number.isSafeInteger(m.revision)||m.revision<1||!/^([a-f0-9]{64})$/.test(m.contentHash)||!Array.isArray(m.assets))throw s.wbError('WORKBENCH_DIRECTORY_INVALID_MANIFEST');
    const base=`${ROOT}/projects/${s.wbId(projectId)}/`;if(typeof m.projectPath!=='string'||!m.projectPath.startsWith(`${base}revisions/`))throw s.wbError('WORKBENCH_DIRECTORY_INVALID_MANIFEST');restrictedPath(m.projectPath);
    for(const a of m.assets){s.wbId(a.id);if(!a.path?.startsWith(`${base}assets/`)||!/^[a-f0-9]{64}$/.test(a.sha256))throw s.wbError('WORKBENCH_DIRECTORY_INVALID_MANIFEST');restrictedPath(a.path);}
    return m;
  }
  async function readResearchWorkbenchDirectoryProject(adapter,projectId) {
    s.wbId(projectId);const manifestPath=`${ROOT}/projects/${projectId}/manifest.json`;const first=await readJson(adapter,manifestPath);if(!first)return null;
    const manifest=manifestValid(first,projectId);const bytes=await adapter.read(manifest.projectPath);if(bytes===null||await s.wbSha256(bytes)!==manifest.contentHash)throw s.wbError('WORKBENCH_DIRECTORY_INCOMPLETE');
    const envelope=JSON.parse(new TextDecoder().decode(bytes));if(envelope.id!==projectId||envelope.project?.id!==projectId||envelope.revision!==manifest.revision||envelope.deleted!==manifest.deleted)throw s.wbError('WORKBENCH_DIRECTORY_INCOMPLETE');s.wbValidateProject(envelope.project);
    const declarations=envelope.deleted?[]:envelope.project.assets.filter(a=>a.sha256);
    if(declarations.length!==manifest.assets.length||new Set(manifest.assets.map(a=>a.id)).size!==manifest.assets.length||declarations.some(a=>!manifest.assets.some(m=>m.id===a.id&&m.sha256===a.sha256&&m.mimeType===a.mimeType&&m.byteLength===a.byteLength)))throw s.wbError('WORKBENCH_DIRECTORY_INCOMPLETE');
    const assets=[];for(const a of manifest.assets){const bytes=await adapter.read(a.path);if(bytes===null||bytes.byteLength!==a.byteLength||await s.wbSha256(bytes)!==a.sha256)throw s.wbError('WORKBENCH_DIRECTORY_INCOMPLETE',{assetId:a.id});assets.push({...a,bytes});}
    const second=await readJson(adapter,manifestPath);if(s.wbJson(first)!==s.wbJson(second))throw s.wbError('WORKBENCH_DIRECTORY_CHANGED');return {manifest,envelope,assets};
  }
  async function syncResearchWorkbenchOutbox({store,adapter,locks=store?.locks,projectId}={}) {
    if(!store||!adapter)throw s.wbError('WORKBENCH_SYNC_ADAPTER_UNAVAILABLE');if(!locks?.request)throw s.wbError('WORKBENCH_SYNC_LOCK_UNAVAILABLE');
    return locks.request('brevess-workbench-directory',{mode:'exclusive'},async()=>{
      const results=[];const items=(await store.listOutbox()).filter(q=>['pending','failed'].includes(q.state)&&(!projectId||q.projectId===projectId));
      for(const item of items) await store.withProjectLock(item.projectId,async()=>{
        let state='failed';let error=null;
        try {
          const latest=await store.getProject(item.projectId,{includeDeleted:true});
          if(!latest||latest.revision!==item.revision||latest.deleted!==item.deleted){state='obsolete';return;}
          const base=`${ROOT}/projects/${item.projectId}`;const manifestPath=`${base}/manifest.json`;const payload=s.wbJson(item.snapshot);const hash=await s.wbSha256(payload);
          const mirrorPath=`${base}/project.json`;const mirror=await adapter.read(mirrorPath);const mirrorHash=mirror===null?null:await s.wbSha256(mirror);
          if(mirrorHash&&mirrorHash!==hash){let localMirror=false;for(const queued of await store.listOutbox())if(queued.projectId===item.projectId&&queued.revision<=item.revision&&await s.wbSha256(s.wbJson(queued.snapshot))===mirrorHash){localMirror=true;break;}if(!localMirror){await writeVerified(adapter,`${base}/conflicts/external-mirror-${mirrorHash}.json`,mirror);throw s.wbError('WORKBENCH_DIRECTORY_CONFLICT');}}
          const previous=await readJson(adapter,manifestPath);
          if(previous){manifestValid(previous,item.projectId);if(previous.revision>item.revision||(previous.revision===item.revision&&previous.contentHash!==hash)){
            await writeVerified(adapter,`${base}/conflicts/${item.revision}-${hash}.json`,payload);throw s.wbError('WORKBENCH_DIRECTORY_CONFLICT');
          }
            // External edits may change file bytes without updating their manifest hash.
            // Preserve those bytes before any immutable path can be reused.
            const external=await adapter.read(previous.projectPath);
            if(external!==null&&await s.wbSha256(external)!==previous.contentHash){
              await writeVerified(adapter,`${base}/conflicts/external-${previous.revision}-${await s.wbSha256(external)}.json`,external);
              await writeVerified(adapter,`${base}/conflicts/${item.revision}-${hash}.json`,payload);throw s.wbError('WORKBENCH_DIRECTORY_CONFLICT');
            }
            for(const a of previous.assets){const external=await adapter.read(a.path);if(external!==null&&await s.wbSha256(external)!==a.sha256){await writeVerified(adapter,`${base}/conflicts/external-asset-${await s.wbSha256(external)}.bin`,external);throw s.wbError('WORKBENCH_DIRECTORY_CONFLICT');}}
          }
          const assets=[];
          if(!item.deleted)for(const meta of item.snapshot.project.assets){
            // References without local binary remain explicit unavailable metadata, never a fake file.
            if(!meta.sha256)continue;const a=await store.getAsset(item.projectId,meta.id);if(!a||a.sha256!==meta.sha256||await s.wbSha256(a.bytes)!==a.sha256)throw s.wbError('WORKBENCH_ASSET_UNAVAILABLE',{assetId:meta.id});
            const path=`${base}/assets/${a.sha256}.bin`;await writeVerified(adapter,path,a.bytes);assets.push({id:a.id,path,sha256:a.sha256,mimeType:a.mimeType,byteLength:a.bytes.length});
          }
          const path=`${base}/revisions/${item.revision}-${hash}/project.json`;await writeVerified(adapter,path,payload);
          // Convenience mirror can be interrupted; readers always follow immutable manifest.projectPath.
          const currentMirror=await adapter.read(mirrorPath);if((currentMirror===null?null:await s.wbSha256(currentMirror))!==mirrorHash){if(currentMirror!==null)await writeVerified(adapter,`${base}/conflicts/external-mirror-${await s.wbSha256(currentMirror)}.json`,currentMirror);throw s.wbError('WORKBENCH_DIRECTORY_CONFLICT');}await writeVerified(adapter,mirrorPath,payload);
          const current=await store.getProject(item.projectId,{includeDeleted:true});if(current?.revision!==item.revision||current.deleted!==item.deleted){state='obsolete';return;}
          const beforePublish=await readJson(adapter,manifestPath);if(s.wbJson(beforePublish)!==s.wbJson(previous)){
            await writeVerified(adapter,`${base}/conflicts/${item.revision}-${hash}.json`,payload);throw s.wbError('WORKBENCH_DIRECTORY_CONFLICT');
          }
          const manifest={kind:'brevess-research-workbench-project',schemaVersion:1,projectId:item.projectId,revision:item.revision,deleted:item.deleted,contentHash:hash,projectPath:path,assets};
          await writeVerified(adapter,manifestPath,s.wbJson(manifest));
          await readResearchWorkbenchDirectoryProject(adapter,item.projectId);
          const indexPath=`${ROOT}/index.json`;const index=await readJson(adapter,indexPath) || {kind:'brevess-research-workbench-index',schemaVersion:1,projects:[]};
          if(index.kind!=='brevess-research-workbench-index'||index.schemaVersion!==1||!Array.isArray(index.projects))throw s.wbError('WORKBENCH_DIRECTORY_INVALID_INDEX');
          index.projects=index.projects.filter(p=>p.projectId!==item.projectId);index.projects.push({projectId:item.projectId,revision:item.revision,deleted:item.deleted,contentHash:hash,manifestPath});
          await writeVerified(adapter,indexPath,s.wbJson(index));state='synced';
        }catch(e){error={code:e.code||'WORKBENCH_DIRECTORY_WRITE_FAILED'};state=e.code==='WORKBENCH_DIRECTORY_PERMISSION'?'pending':'failed';}
        finally {await store.settleOutbox(item,state,error);results.push({projectId:item.projectId,revision:item.revision,state,error});}
      });return results;
    });
  }
  return {createResearchWorkbenchDirectoryAdapter,readResearchWorkbenchDirectoryProject,syncResearchWorkbenchOutbox};
});
