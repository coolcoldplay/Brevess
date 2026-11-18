(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.Workbench ||= {};Object.assign(root.Workbench,api);root.Workbench.agentPermissions=api.createPermissions({storage:chrome.storage.local,onChanged:chrome.storage.onChanged});}})(globalThis,()=>{
 'use strict';
 const key='brevessWorkbenchAgentPermissionsV1',bits=['read','modify','delete'];
 const fault=code=>Object.assign(new Error(code==='WORKBENCH_AGENT_PERMISSION_UNKNOWN'?'未知操作未获授权。':'Agent 对应权限未启用或已撤销，请在侧栏检查权限按钮。'),{code});
 const reads=new Set(['read_context','list_projects','get_project','query_library','read_literature','list_recycle','export_project','read_asset','locate_source','radar_list','radar_get','reading_list_tabs','reading_inspect','reading_status']);
 const writes=new Set(['create_project','navigate','save_view','invoke_action','import_project','import_asset','restore','radar_save','radar_check','radar_backfill_abstracts','radar_mark_read','reading_open','reading_start','reading_cancel','reading_bundle']);
 const operations=new Set(['create_hypothesis','create_plan','create_figure','create_node','create_edge','create_panel','arrange','layout','duplicate','group','ungroup','design_panels','branch_plan','save_plan_version','move_panels','reorder_figures','capture_resource','bind_resource','set_panel_schedule','set_panel_status','edit_group_table','attach_material','update_material_stance','create_evidence_block','set_edge_relation']);
 const collectIds=value=>{const ids=new Set();function visit(v){if(!v||typeof v!=='object')return;if(typeof v.id==='string')ids.add(v.id);for(const child of Object.values(v))visit(child)}visit(value);return ids;};
 const losesEntities=(before,after)=>{const next=collectIds(after);return [...collectIds(before)].some(id=>!next.has(id));};
 function classify(name,args={},state){
  if(reads.has(name))return ['read'];if(writes.has(name))return ['modify'];if(name==='remove_entity')return ['delete'];
  if(name==='clipboard'){if(args.operation==='copy')return ['read'];if(args.operation==='paste')return ['modify'];}
  if(name==='local_data'){if(['query_library','read_workspace','read_export','read_asset'].includes(args.operation))return ['read'];if(['patch_asset','set_tags'].includes(args.operation))return ['modify'];if(args.operation==='delete_workspace')return ['delete'];}
  if(name==='data_directory'&&['open','ensure'].includes(args.operation))return ['modify'];
  if(name==='model_operation'){if(args.operation==='delete_objects')return ['delete'];if(!operations.has(args.operation))throw fault('WORKBENCH_AGENT_PERMISSION_UNKNOWN');return args.operation==='edit_group_table'&&/^(delete|remove)_/.test(args.change?.action||'')?['modify','delete']:['modify'];}
  if(name==='edit_project'){
   let deleting=false;for(const op of args.operations||[]){if(op.op==='remove')deleting=true;if(op.op==='set'&&op.value&&typeof op.value==='object'){let old=state?.row?.project;for(const part of op.path||[])old=part&&typeof part==='object'?old?.find?.(v=>v.id===part.id):old?.[part];if(old===undefined||losesEntities(old,op.value))deleting=true;}}
   return deleting?['modify','delete']:['modify'];
  }
  if(name==='undo'||name==='redo'){const item=state?.[name==='undo'?'undo':'redo']?.at(-1);if(item?.kind==='delete')return [name==='redo'?'delete':'modify'];if(!item)return ['modify'];return losesEntities(name==='undo'?item.after:item.before,name==='undo'?item.before:item.after)?['modify','delete']:['modify'];}
  throw fault('WORKBENCH_AGENT_PERMISSION_UNKNOWN');
 }
 const valid=v=>v&&typeof v==='object'&&!Array.isArray(v)&&v.version===1&&bits.every(k=>typeof v[k]==='boolean')&&typeof v.revision==='string'&&v.revision.length>0&&v.revision.length<129&&Number.isSafeInteger(v.updatedAt)&&v.updatedAt>0;
 function createPermissions({storage,onChanged,locks=globalThis.navigator?.locks}={}){
  let record=null,epoch=0,last,writing=false;const listeners=new Set();
  const snapshot=()=>Object.fromEntries(bits.map(k=>[k,!writing&&!!valid(record)&&record[k]===true]));
  const notify=()=>listeners.forEach(fn=>fn(snapshot()));
  const update=next=>{const changed=JSON.stringify(record)!==JSON.stringify(next);record=next;if(changed)notify();};
  onChanged?.addListener((changes,area)=>{if(area==='local'&&Object.hasOwn(changes,key)){epoch++;last=changes[key].newValue;update(valid(last)?last:null);}});
  async function refresh(){const start=epoch;try{const result=await storage.get(key),value=start===epoch?result[key]:last;update(valid(value)?value:null);return snapshot();}catch(e){update(null);throw e;}}
  const api={snapshot,refresh,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},async set(bit,value,trusted){
   if(!trusted||writing||!bits.includes(bit)||typeof value!=='boolean')throw fault('WORKBENCH_AGENT_PERMISSION_DENIED');
   writing=true;notify();
   try{const commit=async()=>{await refresh();const previous=Object.fromEntries(bits.map(k=>[k,!!valid(record)&&record[k]===true]));record=null;notify();const next={version:1,...previous,[bit]:value,revision:globalThis.crypto?.randomUUID?.()||String(Date.now())+Math.random(),updatedAt:Date.now()};await storage.set({[key]:next});await refresh();};if(locks)await locks.request(key,commit);else await commit();}
   catch(e){record=null;notify();throw e;}finally{writing=false;notify();}
   return snapshot();
  },async acquire(name,args,state){await refresh();const required=classify(name,args,state);if(!required.every(k=>snapshot()[k]))throw fault('WORKBENCH_AGENT_PERMISSION_DENIED');return {revision:record.revision,required};},assert(grant){if(writing||!grant||!valid(record)||record.revision!==grant.revision||!grant.required.every(k=>record[k]))throw fault('WORKBENCH_AGENT_PERMISSION_REVOKED');},redactContext(context){return snapshot().read?context:{permissions:snapshot(),readDenied:true};},redactReceipts(receipts){return snapshot().read?receipts:receipts.map(r=>({id:r.id,name:r.name,success:r.success,...(r.success?{result:{status:'completed'}}:{error:{code:r.error?.code||'WORKBENCH_AGENT_TOOL_FAILED',message:'操作未完成，请检查权限和目标版本。'}})}));}};
  api.withCommit=async(grant,fn)=>{const commit=async()=>{await refresh();api.assert(grant);return fn();};return locks?locks.request(key,commit):commit();};
  return api;
 }
 return {createPermissions,classify};
});
