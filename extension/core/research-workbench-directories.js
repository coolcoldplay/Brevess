(function (root, factory) {
  const s = typeof module === 'object' && module.exports ? require('./research-workbench-model.js') : root.SciLLM;
  const api = factory(s);
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.SciLLM ||= {}, api);
})(globalThis, function (s) {
  'use strict';
  // User experiment files are never written, moved, mirrored or removed here.
  // Only new folders and append-only ownership/mapping metadata are created.
  const DATA_ROOT = 'Brevess/research-data';
  const ROOT_NAMES = Object.freeze(['Brevess','SCI-Highlighter']);
  const MAP_ROOT = '.brevess-directory-map';
  const MARKER = '.brevess-data-directory.json';
  const GROUPS = Object.freeze(['原始数据', '分析数据', '图片']);
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const fail = (suffix, details) => { throw s.wbError(`WORKBENCH_DATA_DIRECTORY_${suffix}`, details); };

  function dataDirectoryTarget(project, target) {
    if (!project || project.deleted === true) fail('TARGET_MISSING');
    s.wbId(project.id);
    const allowed = {project:['kind'],figure:['kind','planId','figureId'],panel:['kind','planId','figureId','panelId']};
    if (!target || Object.getPrototypeOf(target) !== Object.prototype || !allowed[target.kind] ||
        Object.keys(target).some(key => !allowed[target.kind].includes(key)) ||
        allowed[target.kind].some(key => typeof target[key] !== 'string' || !target[key])) fail('INVALID_TARGET');
    const levels = [{identity:{kind:'project',projectId:project.id},name:String(project.name || '新课题')}];
    if (target.kind === 'project') return levels;
    s.wbId(target.planId); s.wbId(target.figureId);
    const plan = project.plans?.find(row => row.id === target.planId);
    const figure = plan?.figures?.find(row => row.id === target.figureId);
    if (!plan || !figure) fail('TARGET_MISSING');
    levels.push({identity:{kind:'plan',projectId:project.id,planId:plan.id},name:String(plan.name || '组图规划')});
    levels.push({identity:{kind:'figure',projectId:project.id,planId:plan.id,figureId:figure.id},name:String(figure.title || figure.name || 'Figure')});
    if (target.kind === 'figure') return levels;
    s.wbId(target.panelId);
    const panel = figure.panels?.find(row => row.id === target.panelId);
    if (!panel) fail('TARGET_MISSING');
    levels.push({identity:{kind:'panel',projectId:project.id,planId:plan.id,figureId:figure.id,panelId:panel.id},name:String(panel.title || panel.name || panel.label || 'Panel')});
    return levels;
  }
  const keyFor = identity => s.wbSha256(s.wbJson(identity));
  function safeName(value, kind) {
    const prefix = {project:'课题',plan:'组图规划',figure:'Figure',panel:'Panel'}[kind];
    const name = Array.from(String(value).normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, '_').trim().replace(/[. ]+$/gu,'')).slice(0,24).join('');
    return `${prefix}-${name || prefix}`;
  }
  function pathValid(value) {
    return typeof value === 'string' && value.length <= 1200 && ROOT_NAMES.some(name=>value.startsWith(`${name}/research-data/`)) &&
      value.split('/').every(part => part && part !== '.' && part !== '..' &&
        !/[\\:*?"<>|\u0000-\u001f\u007f]/u.test(part) && !/[. ]$/u.test(part));
  }
  async function readFile(directory, name) {
    try {
      const handle = await directory.getFileHandle(name);
      const file = await handle.getFile();
      if (file.size > 16384) fail('INVALID_MAPPING');
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
  }
  async function readJson(directory, name) {
    const bytes = await readFile(directory,name);
    if (bytes === null) return null;
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { fail('INVALID_MAPPING'); }
  }
  async function writeNew(directory, name, value) {
    // Metadata files are created once; an existing file is never overwritten.
    if (await readFile(directory,name) !== null) fail('CONFLICT');
    const bytes = await s.wbBytes(s.wbJson(value));
    const file = await directory.getFileHandle(name,{create:true});
    if ((await file.getFile()).size !== 0) fail('CONFLICT');
    const writable = await file.createWritable();
    try { await writable.write(bytes); await writable.close(); }
    catch (error) { try { await writable.abort(); } catch {} throw error; }
    const readback = await readFile(directory,name);
    if (readback === null || await s.wbSha256(readback) !== await s.wbSha256(bytes)) fail('READBACK_MISMATCH');
  }
  async function childDirectory(parent, name, create) {
    try { return await parent.getDirectoryHandle(name,{create}); }
    catch (error) { if (error.name === 'NotFoundError' && !create) return null; throw error; }
  }

  function createResearchWorkbenchDataDirectoryService({getHandle,locks=globalThis.navigator?.locks,openDirectory}={}) {
    async function rootHandle() {
      const handle = await getHandle?.();
      if (!handle || await handle.queryPermission({mode:'readwrite'}) !== 'granted') throw s.wbError('WORKBENCH_DIRECTORY_PERMISSION');
      return handle;
    }
    async function activeRoot(handle, create) {
      // Keep DirectorySync's existing selection policy; ENSURE is not a migration.
      for (const name of ROOT_NAMES) {
        const directory=await childDirectory(handle,name,false);
        if (directory) return {name,directory};
      }
      const directory=await childDirectory(handle,ROOT_NAMES[0],create);
      return directory ? {name:ROOT_NAMES[0],directory} : null;
    }
    async function unchanged(handle, selected) {
      const current = await rootHandle();
      if (handle !== current && (!handle.isSameEntry || await handle.isSameEntry(current) !== true)) fail('ROOT_CHANGED');
      if (selected) {
        const active=await activeRoot(current,false);
        if (!active || active.name!==selected.name || active.directory!==selected.directory &&
            (!selected.directory.isSameEntry || await selected.directory.isSameEntry(active.directory)!==true)) fail('ROOT_CHANGED');
      }
    }
    async function base(handle, create) {
      const selected=await activeRoot(handle,create);
      if (!selected) return null;
      const directory=await childDirectory(selected.directory,'research-data',create);
      return directory ? {directory,selected,dataPath:`${selected.name}/research-data`} : null;
    }
    async function mapped(data, identity, parentPath) {
      const mappingId = await keyFor(identity);
      const maps = await childDirectory(data,MAP_ROOT,false);
      const directory = maps && await childDirectory(maps,mappingId,false);
      if (!directory) return null;
      let result = null, count = 0;
      for await (const [name,handle] of directory.entries()) {
        if (++count > 128) fail('INVALID_MAPPING');
        if (!name.startsWith('map-')) continue;
        const uuid = name.slice(4,-5);
        if (handle.kind !== 'file' || !name.endsWith('.json') || !UUID.test(uuid)) fail('INVALID_MAPPING');
        const record = await readJson(directory,name);
        if (!record || record.kind !== 'brevess-research-data-directory' || record.schemaVersion !== 1 ||
            record.mappingId !== mappingId || record.recordId !== uuid || s.wbJson(record.identity) !== s.wbJson(identity) ||
            !pathValid(record.relativePath) || record.relativePath.split('/').slice(0,-1).join('/') !== parentPath ||
            typeof record.originalDisplayName !== 'string') fail('INVALID_MAPPING');
        if (result && result.relativePath !== record.relativePath) fail('CONFLICT');
        result = {...record,mappingRecordFile:`${parentPath.split('/').slice(0,2).join('/')}/${MAP_ROOT}/${mappingId}/${name}`};
      }
      return result;
    }
    async function resolve(handle, relativePath) {
      if (!pathValid(relativePath)) fail('INVALID_MAPPING');
      let current = handle;
      for (const name of relativePath.split('/')) {
        current = await childDirectory(current,name,false);
        if (!current) fail('MISSING');
      }
      return current;
    }
    async function owned(handle, record) {
      const directory = await resolve(handle,record.relativePath);
      const marker = await readJson(directory,MARKER);
      const {mappingRecordFile,...expected} = record;
      if (!marker || s.wbJson(marker) !== s.wbJson(expected)) fail('IDENTITY_CHANGED');
      return directory;
    }
    async function createLevel(data, parent, parentPath, level, guard) {
      const mappingId = await keyFor(level.identity);
      const stem = `${safeName(level.name,level.identity.kind)}__${mappingId.slice(0,16)}`;
      let directory, name;
      for (let attempt=0;attempt<100;attempt++) {
        name = `${stem}${attempt ? `-${attempt}` : ''}`;
        // Reusing an unregistered folder would adopt user files. Always bypass it.
        if (await childDirectory(parent,name,false)) continue;
        await guard();
        directory = await parent.getDirectoryHandle(name,{create:true});
        let occupied = false; for await (const ignored of directory.entries()) { occupied=true; break; }
        if (occupied) { directory=null; continue; }
        break;
      }
      if (!directory) fail('CONFLICT');
      const record = {kind:'brevess-research-data-directory',schemaVersion:1,mappingId,
        recordId:globalThis.crypto.randomUUID(),identity:level.identity,
        relativePath:`${parentPath}/${name}`,originalDisplayName:level.name};
      await guard();await writeNew(directory,MARKER,record);
      for (const name of GROUPS) await directory.getDirectoryHandle(name,{create:true});
      await guard();
      const maps = await data.getDirectoryHandle(MAP_ROOT,{create:true});
      const destination = await maps.getDirectoryHandle(mappingId,{create:true});
      const recordFile = `map-${record.recordId}.json`;
      await writeNew(destination,recordFile,record);
      await guard();
      return {...record,mappingRecordFile:`${parentPath.split('/').slice(0,2).join('/')}/${MAP_ROOT}/${mappingId}/${recordFile}`};
    }
    async function run(project, target, create, open, {precondition}={}) {
      const levels = dataDirectoryTarget(project,target);
      if (!locks?.request) fail('LOCK_UNAVAILABLE');
      return locks.request('brevess-workbench-directory',{mode:'exclusive'},async()=>{
        await precondition?.();
        const handle=await rootHandle(),context=await base(handle,create);
        if (!context) fail('MISSING');
        const data=context.directory,guard=()=>unchanged(handle,context.selected);
        let parent=data,parentPath=context.dataPath,record,created=false;
        for (const level of levels) {
          await precondition?.();
          await guard();
          record = await mapped(data,level.identity,parentPath);
          if (!record) {
            if (!create) fail('MISSING');
            record=await createLevel(data,parent,parentPath,level,guard);created=true;
          }
          parent=await owned(handle,record);
          if (create) for (const name of GROUPS) await parent.getDirectoryHandle(name,{create:true});
          parentPath=record.relativePath;
        }
        await guard();
        const result={created,mappingId:record.mappingId,mappingRecordId:record.recordId,identity:record.identity,relativePath:record.relativePath,
          mappingRecordFile:record.mappingRecordFile,rootName:context.selected.name,displayName:levels.at(-1).name,
          originalDisplayName:record.originalDisplayName,folders:[...GROUPS]};
        if (open) {
          if (typeof openDirectory !== 'function') fail('OPEN_UNAVAILABLE');
          await precondition?.();
          await owned(handle,record);await guard();
          const receipt=await openDirectory({...result});
          if (receipt?.opened !== true || receipt.mappingId !== record.mappingId) fail('OPEN_RECEIPT_MISMATCH');
          await guard();await owned(handle,record);
          result.opened=true;
        }
        return result;
      });
    }
    return {ensure:(project,target,options)=>run(project,target,true,false,options),open:(project,target,options)=>run(project,target,false,true,options)};
  }
  return {createResearchWorkbenchDataDirectoryService,RESEARCH_WORKBENCH_DATA_ROOT:DATA_ROOT,
    RESEARCH_WORKBENCH_DATA_FOLDERS:GROUPS};
});
