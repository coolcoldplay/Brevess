'use strict';
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string',minLength:1,maxLength:20000},id={type:'string',minLength:1,maxLength:160},number={type:'number'},point=object({x:number,y:number});
const ids={type:'array',minItems:1,maxItems:64,uniqueItems:true,items:id},types={type:'array',maxItems:3,uniqueItems:true,items:{enum:['sufficient','necessary','related']}};
const context=object(Object.fromEntries(['species','tissue','model','time','condition','predicate','effect','summary','cellType','compartment','timepoint','dose'].map(k=>[k,{type:'string',maxLength:20000}])),[]);
const target=object({tabId:{type:'integer',minimum:0},contextKey:string,documentKey:string,documentId:id,workspaceId:id,workspaceGeneration:{type:'integer',minimum:1},workspaceLifecycle:{type:'integer',minimum:0}});
const evidence=object({sourceFingerprint:id,contentFingerprint:id});
const command=(type,properties,required=Object.keys(properties))=>object({type:{const:type},...properties},['type',...required]);
const commands={type:'array',minItems:1,maxItems:32,items:{oneOf:[
 command('add_node',{node:object({id,label:string}),position:point},['node']),command('update_node',{nodeId:id,label:string}),
 command('add_edge',{edge:object({id,from:id,to:id,label:{type:'string',maxLength:20000},polarity:{enum:['neutral','positive','negative']},context},['id','from','to'])}),
 command('update_edge',{edgeId:id,from:id,to:id,label:{type:'string',maxLength:20000},polarity:{enum:['neutral','positive','negative']},context},['edgeId']),
 command('bind_block',{binding:object({id,edgeId:id,figureId:id,blockId:id,panelIds:ids,types},['id','edgeId','figureId','blockId','panelIds']),evidence}),
 command('replace_binding',{bindingId:id,figureId:id,blockId:id,panelIds:ids,evidence}),command('set_binding_types',{bindingId:id,types,evidence}),
 command('move_nodes',{positions:{type:'array',minItems:1,maxItems:64,items:object({nodeId:id,x:number,y:number,pinned:{type:'boolean'}},['nodeId','x','y'])}}),
 command('set_view',{viewport:object({x:number,y:number,zoom:{type:'number',minimum:0.1,maximum:4}}),matrixHeight:{type:'number',minimum:80,maximum:800},mode:{enum:['main','all']},activeStageId:{type:'string',maxLength:80}},[]),
 command('remove_nodes',{nodeIds:ids}),command('remove_edge',{edgeId:id}),command('remove_binding',{bindingId:id})]}};
const key={type:'string',minLength:8,maxLength:160};
const definitions=[
 ['mechanism.read_context',{},[],'Read the single currently open document mechanism and its exact target/revision. Open the document sidebar first; ambiguous owners are rejected.',false],
 ['mechanism.list_evidence',{target},['target'],'List existing evidence blocks with complete Panel membership and source/content fingerprints. Never invent evidence.',false],
 ['brevess.request_document_write_scope',{target,operations:{type:'array',minItems:1,maxItems:3,uniqueItems:true,items:{enum:['edit','layout','delete']}},ttlMs:{type:'integer',minimum:60000,maximum:3600000}},['target','operations'],'Request explicit consent in this document UI. Default 15 minutes. Delete is optional and always separately confirmed. PENDING means no grant; after human approval repeat this request to collect the receipt.',true],
 ['brevess.revoke_document_write_scope',{target},['target'],'Revoke document permission immediately. Project scopes never authorize document writes.',true],
 ['mechanism.apply_commands',{target,expectedRevision:{type:'integer',minimum:0},idempotencyKey:key,commands},['target','expectedRevision','idempotencyKey','commands'],'Apply 1–32 commands, at most 128 KiB, as one atomic revision-checked edit. Bindings require exact evidence fingerprints. Delete prompts list concrete objects; retry only after human confirmation. No snapshots/raw document replacement.',true],
 ['mechanism.read_receipt',{target,idempotencyKey:key},['target','idempotencyKey'],'Read a prior document write receipt. UNKNOWN_REQUIRES_READ is not permission to replay; inspect current graph before deciding.',false]
].map(([name,properties,required,description,mutating])=>({name,title:name,description,inputSchema:object(properties,required),kind:'document',annotations:{readOnlyHint:!mutating,destructiveHint:name==='mechanism.apply_commands',idempotentHint:true,openWorldHint:false}}));
for(const [name,properties,required,description] of [
 ['ppt.prepare',{target,requestKey:key,customization:{type:'object'}},['target','requestKey'],'Prepare existing materials for only the current document. Returns a session and progress, not a finished PPT. Reuse requestKey on retry; cancel before a different preparation. No model calls.'],
 ['ppt.status',{target,sessionId:id},['target','sessionId'],'Read material preparation state/progress. Failed or expired sessions require a new preparation.'],
 ['ppt.get_manifest',{target,sessionId:id},['target','sessionId'],'Read file IDs, paths, sizes, SHA-256, missing images and customization. Materials are not a finished presentation.'],
 ['ppt.read_chunk',{target,sessionId:id,fileId:id,offset:{type:'integer',minimum:0},length:{type:'integer',minimum:1,maximum:32768}},['target','sessionId','fileId','offset'],'Read at most 32 KiB as base64 after concrete human approval in this document UI. Save chunks locally and verify whole-file SHA-256; do not dump base64 into chat. Switching documents or changed source rejects reads.'],
 ['ppt.cancel',{target,sessionId:id},['target','sessionId'],'Cancel only this material preparation; no document or downloaded file deletion.']
])definitions.push({name,title:name,description,inputSchema:object(properties,required),kind:'document',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}});
module.exports={documentToolDefinitions:definitions};
